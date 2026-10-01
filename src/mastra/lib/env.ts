/**
 * Central env contract. Required vars fail fast where used (see github-app.ts);
 * this module reports the full picture once at boot so misconfiguration shows
 * up in logs instead of as late runtime failures.
 *
 * Required (webhook + tools cannot run without these):
 * - GITHUB_APP_ID, GITHUB_PRIVATE_KEY, GITHUB_WEBHOOK_SECRET
 *
 * Optional (each has a default or graceful fallback):
 * - REDIS_URL (default redis://localhost:6379; webhook returns queued:false if down)
 * - GITHUB_INSTALLATION_ID (Studio manual-run fallback only; webhooks supply the real id)
 *
 * No OpenAI: agents run nvidia/meta/muse-glimmer-30b → ollama-cloud/gpt-oss:120b,
 * observer runs ollama-cloud/gpt-oss:120b. Provider credentials live wherever
 * your model gateway expects them.
 */

const REQUIRED = ["GITHUB_APP_ID", "GITHUB_PRIVATE_KEY", "GITHUB_WEBHOOK_SECRET"] as const;

const OPTIONAL: Array<{ name: string; fallback: string }> = [
  { name: "REDIS_URL", fallback: "defaults to redis://localhost:6379; webhook degrades to queued:false" },
  { name: "GITHUB_INSTALLATION_ID", fallback: "Studio manual runs only; webhooks carry installation.id" },
];

export function checkEnv() {
  const missingRequired = REQUIRED.filter((k) => !process.env[k]?.trim());
  const missingOptional = OPTIONAL.filter((o) => !process.env[o.name]?.trim());
  return { missingRequired, missingOptional };
}

export function logEnvStatus(logger?: { info?: (...a: any[]) => void; error?: (...a: any[]) => void; warn?: (...a: any[]) => void }) {
  const log = logger ?? console;
  const { missingRequired, missingOptional } = checkEnv();
  if (missingRequired.length > 0) {
    log.error?.(`[env] MISSING required: ${missingRequired.join(", ")} — webhook/tools will fail until set`);
  } else {
    log.info?.("[env] required GitHub App vars present");
  }
  for (const o of missingOptional) {
    (log.warn ?? log.info)?.(`[env] ${o.name} not set (${o.fallback})`);
  }
  return { missingRequired, missingOptional };
}
