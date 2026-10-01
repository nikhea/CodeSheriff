import { mastra } from "../index";
import { startPRWorker } from "./pr-queue";

/**
 * Standalone worker entrypoint for local test:
 *   bun src/mastra/queue/worker.ts
 * (mastra dev runs the server; this process drains the `pr-review` queue.)
 */
const worker = startPRWorker(mastra);
console.log("[pr-worker] started, waiting for jobs…");

const shutdown = async () => {
  console.log("[pr-worker] shutting down…");
  await worker.close();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
