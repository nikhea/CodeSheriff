import { Queue, Worker, type Job } from "bullmq";
import { RequestContext } from "@mastra/core/request-context";
import { getRedisConnection } from "../lib/redis";

export interface IssueTriageJobData {
  owner: string;
  repo: string;
  issueNumber: number;
  installationId: number;
  action?: string;
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

/** Enqueue a triage. BullMQ dedupes by jobId (same issue = one job). */
export async function enqueueIssueTriage(data: IssueTriageJobData) {
  const q = getIssueQueue();
  const job = await q.add("triage", data, {
    jobId: issueJobId(data),
    attempts: 3,
    backoff: { type: "exponential", delay: 5000 },
    removeOnComplete: 100,
    removeOnFail: 500,
  });
  return { jobId: job.id ?? issueJobId(data) };
}

/**
 * Start the triage worker. Runs the issue-triage agent directly (single
 * agent turn — no workflow needed): installationId travels via
 * requestContext so the Octokit tools authenticate.
 */
export function startIssueWorker(mastra: any) {
  const logger = mastra?.getLogger?.() ?? console;
  const worker = new Worker<IssueTriageJobData>(
    QUEUE_NAME,
    async (job: Job<IssueTriageJobData>) => {
      const { owner, repo, issueNumber, installationId } = job.data;
      logger.info?.(
        `[issue-worker] run job=${job.id} repo=${owner}/${repo} issue=${issueNumber} attempt=${job.attemptsMade + 1}`
      );

      const requestContext = new RequestContext();
      requestContext.set("installationId" as any, installationId);

      const agent = mastra.getAgentById("issue-triage-agent");
      const result = await agent.generate(
        `Triage the newly opened issue ${owner}/${repo}#${issueNumber}: fetch it, check it against what the repo is building, post the verdict comment, set labels.`,
        { requestContext } as any
      );
      logger.info?.(
        `[issue-worker] done job=${job.id} finish=${(result as any)?.finishReason ?? "unknown"}`
      );
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
