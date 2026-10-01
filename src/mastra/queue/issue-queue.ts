import { Queue, Worker, type Job } from "bullmq";
import { RequestContext } from "@mastra/core/request-context";
import { getRedisConnection } from "../lib/redis";
import { publishTriageProgress } from "../lib/triage-events";

export interface IssueTriageJobData {
  owner: string;
  repo: string;
  issueNumber: number;
  installationId: number;
  action?: string;
  kind?: "triage" | "followup";
  /** Human comment that triggered a follow-up (followup only). */
  commentId?: number;
}

const QUEUE_NAME = "issue-triage";

let queue: Queue<IssueTriageJobData> | null = null;

export function getIssueQueue(): Queue<IssueTriageJobData> {
  if (!queue) {
    queue = new Queue<IssueTriageJobData>(QUEUE_NAME, { connection: getRedisConnection() });
  }
  return queue;
}

export function issueJobId(d: Pick<IssueTriageJobData, "owner" | "repo" | "issueNumber">): string {
  return `issue-${d.owner}-${d.repo}-${d.issueNumber}`;
}

/** Follow-up jobs key on the triggering comment: redeliveries dedupe, distinct comments run. */
export function issueFollowupJobId(
  d: Pick<IssueTriageJobData, "owner" | "repo" | "issueNumber" | "commentId">
): string {
  return `issue-${d.owner}-${d.repo}-${d.issueNumber}-c${d.commentId}`;
}

/** Re-triage after reopen: distinct from the opened job (which may linger completed). */
export function issueReopenedJobId(d: Pick<IssueTriageJobData, "owner" | "repo" | "issueNumber">): string {
  return `issue-${d.owner}-${d.repo}-${d.issueNumber}-reopened`;
}

const baseOpts = {
  attempts: 3,
  backoff: { type: "exponential", delay: 5000 },
  removeOnComplete: 100,
  removeOnFail: 500,
} as const;

/** Enqueue a triage. BullMQ dedupes by jobId (same issue = one job). */
export async function enqueueIssueTriage(data: IssueTriageJobData) {
  const q = getIssueQueue();
  const job = await q.add("triage", { kind: "triage", ...data }, { ...baseOpts, jobId: issueJobId(data) });
  return { jobId: job.id ?? issueJobId(data) };
}

/** Enqueue a comment follow-up. One job per triggering comment. */
export async function enqueueIssueFollowup(data: IssueTriageJobData & { commentId: number }) {
  const q = getIssueQueue();
  const id = issueFollowupJobId(data);
  const job = await q.add("followup", { kind: "followup", ...data }, { ...baseOpts, jobId: id });
  return { jobId: job.id ?? id };
}

/** Enqueue a re-triage after reopen. */
export async function enqueueIssueReopened(data: IssueTriageJobData) {
  const q = getIssueQueue();
  const id = issueReopenedJobId(data);
  const job = await q.add("triage", { kind: "triage", ...data }, { ...baseOpts, jobId: id });
  return { jobId: job.id ?? id };
}

/** Best-effort: drop a queued (not yet running) job, e.g. on issue close. */
export async function dropIssueJob(jobId: string): Promise<boolean> {
  try {
    const job = await getIssueQueue().getJob(jobId);
    if (!job) return false;
    const state = await job.getState();
    if (state !== "waiting" && state !== "delayed" && state !== "prioritized") return false;
    await job.remove();
    return true;
  } catch {
    return false;
  }
}

/** Drop every pending job id we may have queued for an issue. */
export async function dropIssueJobs(
  d: Pick<IssueTriageJobData, "owner" | "repo" | "issueNumber">
): Promise<number> {
  let dropped = 0;
  const ids = [issueJobId(d), issueReopenedJobId(d)];
  for (const id of ids) {
    if (await dropIssueJob(id)) dropped++;
  }
  // Follow-ups key on comment ids we don't track here — sweep delayed/waiting.
  try {
    const prefix = `issue-${d.owner}-${d.repo}-${d.issueNumber}-c`;
    for (const state of ["waiting", "delayed"] as const) {
      const jobs = await getIssueQueue().getJobs(state, 0, 100);
      for (const job of jobs) {
        if (job.id?.startsWith(prefix)) {
          try {
            await job.remove();
            dropped++;
          } catch {
            /* raced with pickup */
          }
        }
      }
    }
  } catch {
    /* advisory only */
  }
  return dropped;
}

/** Throttled text-delta publisher: buffers deltas, flushes on size or interval. */
function deltaFlusher(
  owner: string,
  repo: string,
  issueNumber: number,
  maxChars = 500,
  maxMs = 750
) {
  let buf = "";
  let last = Date.now();
  const flush = async () => {
    if (!buf) return;
    const delta = buf;
    buf = "";
    last = Date.now();
    await publishTriageProgress(owner, repo, issueNumber, { type: "text", delta });
  };
  return {
    push: async (s: string) => {
      buf += s;
      if (buf.length >= maxChars || Date.now() - last >= maxMs) await flush();
    },
    flush,
  };
}

/**
 * Start the triage worker. Streams the issue-triage agent (same agentic
 * loop + tools as generate) and publishes stage/tool/text events to the
 * triage SSE channel: installationId travels via requestContext, memory
 * ids scope history per issue and profile per repo.
 */
export function startIssueWorker(mastra: any) {
  const logger = mastra?.getLogger?.() ?? console;
  const worker = new Worker<IssueTriageJobData>(
    QUEUE_NAME,
    async (job: Job<IssueTriageJobData>) => {
      const { owner, repo, issueNumber, installationId } = job.data;
      const kind = job.data.kind ?? "triage";
      logger.info?.(
        `[issue-worker] run job=${job.id} repo=${owner}/${repo} issue=${issueNumber} kind=${kind} attempt=${job.attemptsMade + 1}`
      );

      const requestContext = new RequestContext();
      requestContext.set("installationId" as any, installationId);

      const prompt =
        kind === "followup"
          ? `Issue ${owner}/${repo}#${issueNumber} has a new human comment (id ${job.data.commentId}). Fetch the issue plus recent comments. If it carries no triaged-* label, do a full triage. Otherwise reply directly to the new comment's points: post exactly one comment, adjust labels only if your verdict changed.`
          : `Triage the newly opened issue ${owner}/${repo}#${issueNumber}: fetch it, check it against what the repo is building, post the verdict comment, set labels.`;

      const agent = mastra.getAgentById("issue-triage-agent");
      const pub = (e: Parameters<typeof publishTriageProgress>[3]) =>
        publishTriageProgress(owner, repo, issueNumber, e);
      await pub({ type: "started", issue: issueNumber, kind });
      await pub({ type: "stage", message: kind === "followup" ? "Reading new comment…" : "Fetching issue + repo vision…" });

      const flusher = deltaFlusher(owner, repo, issueNumber);
      const seenTools = new Set<string>();
      try {
        const stream = await agent.stream([{ role: "user", content: prompt }] as any, {
          requestContext,
          memory: { thread: `issue-${owner}-${repo}-${issueNumber}`, resource: `repo-${owner}/${repo}` },
        } as any);
        for await (const chunk of (stream as any).fullStream) {
          try {
            if (typeof chunk === "string") {
              await flusher.push(chunk);
              continue;
            }
            const t = String((chunk as any)?.type ?? "");
            const text = (chunk as any)?.text ?? (chunk as any)?.textDelta ?? "";
            if (typeof text === "string" && text) {
              await flusher.push(text);
              continue;
            }
            // Tool visibility (AI-SDK part shapes vary — match defensively).
            const toolName = (chunk as any)?.toolName ?? (chunk as any)?.name;
            if (toolName && /tool/i.test(t)) {
              if (/result|response|output/i.test(t)) {
                await pub({ type: "tool", name: String(toolName), status: "completed" });
              } else if (!seenTools.has(`${t}:${toolName}`)) {
                seenTools.add(`${t}:${toolName}`);
                await pub({ type: "tool", name: String(toolName), status: "started" });
              }
            }
          } catch {
            /* one bad chunk never breaks the run */
          }
        }
      } catch (err: any) {
        await flusher.flush();
        await pub({ type: "completed", summary: `${kind} failed: ${err?.message ?? err}` });
        throw err;
      }
      await flusher.flush();
      const summary = kind === "followup" ? `follow-up reply posted on #${issueNumber}` : `verdict posted on #${issueNumber}`;
      await pub({ type: "completed", summary });
      logger.info?.(`[issue-worker] done job=${job.id} kind=${kind}`);
      return { ok: true };
    },
    {
      connection: getRedisConnection(),
      concurrency: 2,
      limiter: { max: 5, duration: 60_000 },
      lockDuration: 5 * 60 * 1000,
    }
  );

  worker.on("completed", (job) => logger.info?.(`[issue-worker] completed ${job.id}`));
  worker.on("failed", (job, err) =>
    logger.error?.(`[issue-worker] failed ${job?.id}: ${err?.message ?? err}`)
  );
  worker.on("error", (err) => logger.error?.(`[issue-worker] error: ${err?.message ?? err}`));

  return worker;
}
