import { Queue, Worker, type Job } from "bullmq";
import IORedis from "ioredis";
import { RequestContext } from "@mastra/core/request-context";
import { postFailedComment } from "../lib/github-post";

export interface PRReviewJobData {
  owner: string;
  repo: string;
  pullNumber: number;
  installationId: number;
  headSha?: string;
  action?: string;
}

const QUEUE_NAME = "pr-review";

let redis: IORedis | null = null;
let queue: Queue<PRReviewJobData> | null = null;

function redisUrl(): string {
  return process.env.REDIS_URL ?? "redis://localhost:6379";
}

/** Shared Redis connection (BullMQ requires maxRetriesPerRequest: null). */
export function getRedisConnection(): IORedis {
  if (!redis) {
    redis = new IORedis(redisUrl(), { maxRetriesPerRequest: null });
    redis.on("error", (err) => console.error("[pr-queue] redis error", err?.message ?? err));
  }
  return redis;
}

export function getPRQueue(): Queue<PRReviewJobData> {
  if (!queue) {
    queue = new Queue<PRReviewJobData>(QUEUE_NAME, { connection: getRedisConnection() });
  }
  return queue;
}

export function prJobId(d: PRReviewJobData): string {
  const sha = (d.headSha ?? "no-sha").slice(0, 12);
  return `pr-${d.owner}-${d.repo}-${d.pullNumber}-${sha}`;
}

/** Enqueue a review. BullMQ dedupes by jobId (same PR+SHA = one job). */
export async function enqueuePRReview(data: PRReviewJobData) {
  const q = getPRQueue();
  const job = await q.add("review", data, {
    jobId: prJobId(data),
    attempts: 3,
    backoff: { type: "exponential", delay: 5000 },
    removeOnComplete: 100,
    removeOnFail: 500,
  });
  return { jobId: job.id ?? prJobId(data) };
}

/**
 * Start the review worker. The `mastra` instance is passed in so the same
 * function works in-process (`mastra dev`) and in a separate `bun worker.ts`.
 */
export function startPRWorker(mastra: any) {
  const logger = mastra?.getLogger?.() ?? console;
  const worker = new Worker<PRReviewJobData>(
    QUEUE_NAME,
    async (job: Job<PRReviewJobData>) => {
      const { owner, repo, pullNumber, installationId, headSha } = job.data;
      logger.info?.(
        `[pr-worker] run job=${job.id} repo=${owner}/${repo} pr=${pullNumber} sha=${headSha} attempt=${job.attemptsMade + 1}`
      );

      const requestContext = new RequestContext();
      requestContext.set("installationId" as any, installationId);
      requestContext.set("action" as any, job.data.action ?? "opened");

      const workflow = mastra.getWorkflow("prReviewWorkflow");
      const run = await workflow.createRun();
      const result = await run.start({
        inputData: { owner, repo, pullNumber },
        requestContext,
      } as any);

      const status = (result as any)?.status ?? "unknown";
      logger.info?.(`[pr-worker] done job=${job.id} status=${status}`);
      if (status === "failed") {
        // Throw so BullMQ retries (attempts/backoff on the queue). Only leave
        // the failure note on the final attempt — don't spam per retry.
        if (job.attemptsMade >= 2) {
          await postFailedComment({ owner, repo, pullNumber, installationId, headSha: headSha ?? "" });
        }
        throw new Error(`workflow failed for ${owner}/${repo}#${pullNumber}`);
      }
      return { ok: true };
    },
    {
      connection: getRedisConnection(),
      concurrency: 2,
      limiter: { max: 5, duration: 60_000 },
      lockDuration: 5 * 60 * 1000, // 5min job timeout — stalled jobs retried via attempts/backoff
    }
  );

  worker.on("completed", (job) => logger.info?.(`[pr-worker] completed ${job.id}`));
  worker.on("failed", (job, err) =>
    logger.error?.(`[pr-worker] failed ${job?.id}: ${err?.message ?? err}`)
  );
  worker.on("error", (err) => logger.error?.(`[pr-worker] error: ${err?.message ?? err}`));

  return worker;
}
