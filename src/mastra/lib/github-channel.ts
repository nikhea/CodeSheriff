import { createGitHubAdapter, type GitHubAdapter } from "@chat-adapter/github";

/**
 * Shared GitHub channel adapter for @mention replies (Track 3 / N2).
 *
 * Multi-tenant GitHub App mode: appId + privateKey, NO fixed installationId.
 * The adapter extracts installation.id per webhook payload and caches
 * Octokit clients per installation.
 *
 * Auto-mounted route (no manual wiring):
 *   /api/agents/code-review-agent/channels/github/webhook
 * Subscribe the App to `Issue comment` + `Pull request review comment`
 * events pointing at that URL. The existing `/webhooks/github` route keeps
 * handling `pull_request` opened/synchronize (no double-handling: different
 * events, different routes).
 *
 * Loop prevention: set GITHUB_BOT_USERNAME (e.g. `xcodesheriff-bot[bot]`)
 * and GITHUB_BOT_USER_ID (numeric id of the `…[bot]` user). Without the
 * numeric id the adapter can't recognise its own comments across processes.
 */

let cached: GitHubAdapter | null = null;

function unescapePrivateKey(raw: string): string {
  const normalized = raw.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  return normalized.includes("\\n") ? normalized.replace(/\\n/g, "\n") : normalized;
}

function parseBotUserId(): number | undefined {
  const raw = process.env.GITHUB_BOT_USER_ID?.trim();
  if (!raw) return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

export function getGitHubChannelAdapter(): GitHubAdapter {
  if (cached) return cached;

  const appId = process.env.GITHUB_APP_ID?.trim() || undefined;
  const privateKeyRaw = process.env.GITHUB_PRIVATE_KEY?.trim() || undefined;
  const userName = process.env.GITHUB_BOT_USERNAME?.trim() || undefined;
  const botUserId = parseBotUserId();

  // Pass explicit App credentials (with \n-escaped PEM restored) so
  // @octokit/auth-app gets a valid key. Missing pieces fall back to the
  // adapter's own env auto-detection (GITHUB_APP_ID / GITHUB_PRIVATE_KEY /
  // GITHUB_WEBHOOK_SECRET / GITHUB_BOT_USERNAME / GITHUB_BOT_USER_ID).
  if (appId && privateKeyRaw) {
    cached = createGitHubAdapter({
      appId,
      privateKey: unescapePrivateKey(privateKeyRaw),
      ...(userName ? { userName } : {}),
      ...(botUserId !== undefined ? { botUserId } : {}),
    });
  } else {
    cached = createGitHubAdapter({
      ...(userName ? { userName } : {}),
      ...(botUserId !== undefined ? { botUserId } : {}),
    });
  }
  return cached;
}

/** Convenience singleton for `channels.adapters.github`. */
export const githubChannelAdapter: GitHubAdapter = getGitHubChannelAdapter();

/**
 * Resolve the installation.id for a channel thread (multi-tenant lookup).
 * Returns undefined in PAT mode or when unknown — callers fall back to
 * GITHUB_INSTALLATION_ID / error downstream.
 */
export async function getChannelInstallationId(thread: any): Promise<number | undefined> {
  try {
    return await getGitHubChannelAdapter().getInstallationId(thread);
  } catch {
    return undefined;
  }
}
