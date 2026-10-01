import { mastra } from "../index";
import { startPRWorker } from "./pr-queue";
import { startIssueWorker } from "./issue-queue";

/**
 * Standalone worker entrypoint for local test:
 *   bun src/mastra/queue/worker.ts
 * (mastra dev runs the server; this process drains the `pr-review` and
 * `issue-triage` queues.)
 */
const prWorker = startPRWorker(mastra);
const issueWorker = startIssueWorker(mastra);
console.log("[pr-worker] started, waiting for jobs…");
console.log("[issue-worker] started, waiting for jobs…");

const shutdown = async () => {
  console.log("[workers] shutting down…");
  await Promise.all([prWorker.close(), issueWorker.close()]);
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
