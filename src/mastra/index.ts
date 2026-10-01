import { Mastra } from "@mastra/core/mastra";
import { RedisStreamsPubSub } from "@mastra/redis-streams";
import { PinoLogger } from "@mastra/loggers";
import { LibSQLStore } from "@mastra/libsql";
import { DuckDBStore } from "@mastra/duckdb";
import { MastraCompositeStore } from "@mastra/core/storage";
import {
  Observability,
  MastraStorageExporter,
  MastraPlatformExporter,
  SensitiveDataFilter,
} from "@mastra/observability";
import { weatherWorkflow } from "./workflows/weather-workflow";
import { prReviewWorkflow } from "./workflows/pr-review-workflow";
import { weatherAgent } from "./agents/weather-agent";
import { codeReviewAgent } from "./agents/code-review-agent";
import { workflowReviewAgent } from "./agents/workflow-review-agent";
import { issueTriageAgent } from "./agents/issue-triage-agent";
import {
  toolCallAppropriatenessScorer,
  completenessScorer,
  translationScorer,
} from "./scorers/weather-scorer";
import { githubWebhookRoute } from "./routes/github-webhook";
import { reviewProgressRoute } from "./routes/review-progress";
import { logEnvStatus } from "./lib/env";

logEnvStatus(console);

export const mastra = new Mastra({
  workflows: { weatherWorkflow, prReviewWorkflow },
  agents: { weatherAgent, codeReviewAgent, workflowReviewAgent, issueTriageAgent },
  scorers: {
    toolCallAppropriatenessScorer,
    completenessScorer,
    translationScorer,
  },
  // Shared pub/sub so signals, leases, and channel threads coordinate across
  // the dev-server and worker processes (in-memory can't cross processes).
  // Local Redis 6.0.16 works for dev; use 6.2+ (or managed Redis) in prod.
  pubsub: new RedisStreamsPubSub({
    url: process.env.REDIS_URL ?? "redis://localhost:6379",
    keyPrefix: "mastra:codesheriff",
  }),
  server: {
    apiRoutes: [githubWebhookRoute, reviewProgressRoute],
  },
  storage: new MastraCompositeStore({
    id: "composite-storage",
    default: new LibSQLStore({
      id: "mastra-storage",
      url: "file:./mastra.db",
    }),
    domains: {
      observability: await new DuckDBStore().getStore("observability"),
    },
  }),
  logger: new PinoLogger({
    name: "Mastra",
    level: "info",
  }),
  observability: new Observability({
    configs: {
      default: {
        serviceName: "mastra",
        exporters: [
          new MastraStorageExporter(), // Persists observability events to Mastra Storage
          new MastraPlatformExporter(), // Sends observability events to Mastra Platform (if MASTRA_PLATFORM_ACCESS_TOKEN is set)
        ],
        spanOutputProcessors: [
          new SensitiveDataFilter(), // Redacts sensitive data like passwords, tokens, keys
        ],
      },
    },
  }),
});
