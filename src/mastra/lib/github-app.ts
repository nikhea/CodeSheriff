import { App } from "@octokit/app";

/**
 * GitHub App singleton.
 * Env required (fail fast):
 * - GITHUB_APP_ID
 * - GITHUB_PRIVATE_KEY (single-line with \n escapes, converted back to newlines)
 * - GITHUB_WEBHOOK_SECRET
 */

let cachedApp: App | null = null;

function requiredEnv(name: string): string {
  const v = process.env[name];
  if (!v || v.trim() === "") {
    throw new Error(
      `[github-app] Missing required env ${name}. ` +
        `Set GITHUB_APP_ID, GITHUB_PRIVATE_KEY (\\n-escaped PEM), GITHUB_WEBHOOK_SECRET, REDIS_URL, OPENAI_API_KEY.`
    );
  }
  return v;
}

export function getGitHubApp(): App {
  if (cachedApp) return cachedApp;

  const appId = requiredEnv("GITHUB_APP_ID");
  const privateKeyRaw = requiredEnv("GITHUB_PRIVATE_KEY");
  const webhookSecret = requiredEnv("GITHUB_WEBHOOK_SECRET");

  // .env can't hold multiline PEM, so we store \n escapes and restore here.
  const privateKey = privateKeyRaw.includes("\\n")
    ? privateKeyRaw.replace(/\\n/g, "\n")
    : privateKeyRaw;

  if (!privateKey.includes("BEGIN") || !privateKey.includes("PRIVATE KEY")) {
    throw new Error(
      "[github-app] GITHUB_PRIVATE_KEY does not look like a PEM. " +
        "Paste the full `-----BEGIN ... PRIVATE KEY-----` block with \\n escapes."
    );
  }

  cachedApp = new App({
    appId,
    privateKey,
    webhooks: { secret: webhookSecret },
  });

  return cachedApp;
}

/**
 * Installation-scoped Octokit (short-lived token, ~1h).
 * installationId comes from webhook payload.installation.id — never hardcode,
 * except GITHUB_INSTALLATION_ID as local-test fallback.
 */
export async function getInstallationOctokit(installationId: number) {
  const app = getGitHubApp();
  return app.getInstallationOctokit(installationId);
}

/** Local-test fallback when triggering manually without a webhook payload. */
export function getTestInstallationId(): number | null {
  const raw = process.env.GITHUB_INSTALLATION_ID;
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}
