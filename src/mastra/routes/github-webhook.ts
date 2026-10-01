import { registerApiRoute } from "@mastra/core/server";
import { Webhooks } from "@octokit/webhooks";
import { enqueuePRReview, prJobId } from "../queue/pr-queue";

/**
 * GitHub App webhook ingress.
 * Verifies HMAC via @octokit/webhooks, filters to PR opened/synchronize,
 * and (Phase 5) enqueues to BullMQ. For Phase 4: validates + logs, returns 202.
 */

const REVIEW_ACTIONS = new Set(["opened", "synchronize", "reopened", "ready_for_review"]);

export const githubWebhookRoute = registerApiRoute("/webhooks/github", {
  method: "POST",
  requiresAuth: false,
  handler: async (c) => {
    const mastra = c.get("mastra");
    const logger = mastra?.getLogger?.() ?? console;

    const secret = process.env.GITHUB_WEBHOOK_SECRET;
    if (!secret) {
      return c.json({ error: "GITHUB_WEBHOOK_SECRET not configured" }, 500);
    }

    // Raw bytes GitHub signed — never c.req.json() first.
    const raw = await c.req.text();
    const signature = c.req.header("x-hub-signature-256") ?? "";
    const event = c.req.header("x-github-event") ?? "";
    const delivery = c.req.header("x-github-delivery") ?? "";

    if (!signature) return c.json({ error: "missing signature" }, 401);

    const webhooks = new Webhooks({ secret });
    const ok = await webhooks.verify(raw, signature);
    if (!ok) return c.json({ error: "bad signature" }, 401);

    let payload: any;
    try {
      payload = JSON.parse(raw);
    } catch {
      return c.json({ error: "invalid JSON" }, 400);
    }

    // GitHub App setup handshake.
    if (event === "ping") {
      logger.info?.(`[webhook] ping delivery=${delivery} zen=${payload?.zen ?? ""}`);
      return c.json({ msg: "pong", zen: payload?.zen ?? null });
    }

    if (event !== "pull_request") {
      return c.json({ received: true, skipped: `event=${event}` });
    }

    const action = payload?.action;
    if (!REVIEW_ACTIONS.has(action)) {
      return c.json({ received: true, skipped: `action=${action}` });
    }

    // Ignore bots / drafts / missing installation.
    if (payload?.sender?.type === "Bot") {
      return c.json({ received: true, skipped: "sender-is-bot" });
    }
    if (payload?.pull_request?.draft === true) {
      return c.json({ received: true, skipped: "draft" });
    }
    const installationId = payload?.installation?.id;
    if (!installationId) {
      return c.json({ error: "missing installation.id" }, 400);
    }

    const owner = payload.repository?.owner?.login;
    const repo = payload.repository?.name;
    const pullNumber = payload.pull_request?.number ?? payload.number;
    const headSha = payload.pull_request?.head?.sha;
    if (!owner || !repo || !pullNumber) {
      return c.json({ error: "missing repo/pr identifiers" }, 400);
    }

    logger.info?.(
      `[webhook] pull_request.${action} delivery=${delivery} repo=${owner}/${repo} pr=${pullNumber} sha=${headSha}`
    );
    (logger as any).debug?.(`[webhook] install=${installationId} delivery=${delivery}`);

    // Phase 5: durable execution via BullMQ (deduped by PR+SHA).
    // Falls back to 202-acknowledged (manual Studio run) if Redis is down.
    try {
      const { jobId } = await enqueuePRReview({
        owner,
        repo,
        pullNumber,
        installationId,
        headSha,
        action,
      });
      return c.json(
        { received: true, queued: true, jobId, owner, repo, pullNumber, headSha, action, delivery },
        202
      );
    } catch (err: any) {
      logger.error?.(`[webhook] enqueue failed: ${err?.message ?? err} (jobId=${prJobId({ owner, repo, pullNumber, installationId, headSha })})`);
      return c.json(
        { received: true, queued: false, error: "queue unavailable", owner, repo, pullNumber, headSha, action, delivery },
        202
      );
    }
  },
});
