import { registerApiRoute } from "@mastra/core/server";
import { Webhooks } from "@octokit/webhooks";
import { enqueuePRReview, prJobId, dropPRJob } from "../queue/pr-queue";
import {
  enqueueIssueTriage,
  enqueueIssueFollowup,
  enqueueIssueReopened,
  dropIssueJobs,
  issueJobId,
} from "../queue/issue-queue";
import { postStartedComment } from "../lib/github-post";

/**
 * GitHub App webhook ingress.
 * Verifies HMAC via @octokit/webhooks, handles:
 * - pull_request opened/synchronize/... → BullMQ pr-review queue
 * - pull_request closed → drop queued review jobs for the SHA
 * - issues opened → BullMQ issue-triage queue (+ reopened re-triage)
 * - issues closed → drop queued triage jobs for the issue
 * - issue_comment created (human) → follow-up triage pass
 * Other events/actions are acknowledged without work.
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

    if (event !== "pull_request" && event !== "issues" && event !== "issue_comment") {
      return c.json({ received: true, skipped: `event=${event}` });
    }

    const action = payload?.action;

    // Shared guards for issue-side events.
    const issueOwner = payload.repository?.owner?.login;
    const issueRepo = payload.repository?.name;

    // Comment follow-ups: a human replied → re-read the thread in context.
    // Bot comments (including our own verdicts) never retrigger.
    if (event === "issue_comment") {
      if (action !== "created") {
        return c.json({ received: true, skipped: `issue_comment.action=${action}` });
      }
      if (payload?.sender?.type === "Bot") {
        return c.json({ received: true, skipped: "sender-is-bot" });
      }
      const installationId = payload?.installation?.id;
      if (!installationId) {
        return c.json({ error: "missing installation.id" }, 400);
      }
      const issueNumber = payload.issue?.number;
      const commentId = payload.comment?.id;
      if (!issueOwner || !issueRepo || !issueNumber || !commentId) {
        return c.json({ error: "missing repo/issue/comment identifiers" }, 400);
      }
      // PR conversation comments arrive here too (issue_number == PR number
      // with no `issue` key nuance) — only triage real issues. Pull request
      // payloads carry pull_request; plain issues don't.
      if (payload.issue?.pull_request) {
        return c.json({ received: true, skipped: "comment-on-pr" });
      }
      logger.info?.(
        `[webhook] issue_comment.created delivery=${delivery} repo=${issueOwner}/${issueRepo} issue=${issueNumber} comment=${commentId}`
      );
      try {
        const { jobId } = await enqueueIssueFollowup({
          owner: issueOwner, repo: issueRepo, issueNumber, installationId, action, commentId,
        });
        return c.json({ received: true, queued: true, jobId, issueNumber, commentId, delivery }, 202);
      } catch (err: any) {
        logger.error?.(`[webhook] followup enqueue failed: ${err?.message ?? err}`);
        return c.json({ received: true, queued: false, error: "queue unavailable", delivery }, 202);
      }
    }

    // Issue lifecycle: opened → triage, reopened → re-triage,
    // closed → drop anything still queued for the issue.
    if (event === "issues") {
      const issueNumber = payload.issue?.number ?? payload.number;
      if (!issueOwner || !issueRepo || !issueNumber) {
        return c.json({ error: "missing repo/issue identifiers" }, 400);
      }
      if (action === "closed") {
        const dropped = await dropIssueJobs({ owner: issueOwner, repo: issueRepo, issueNumber });
        logger.info?.(
          `[webhook] issues.closed delivery=${delivery} repo=${issueOwner}/${issueRepo} issue=${issueNumber} dropped=${dropped}`
        );
        return c.json({ received: true, closed: true, dropped, issueNumber, delivery });
      }
      if (action !== "opened" && action !== "reopened") {
        return c.json({ received: true, skipped: `issues.action=${action}` });
      }
      if (payload?.sender?.type === "Bot") {
        return c.json({ received: true, skipped: "sender-is-bot" });
      }
      const installationId = payload?.installation?.id;
      if (!installationId) {
        return c.json({ error: "missing installation.id" }, 400);
      }
      const owner = issueOwner;
      const repo = issueRepo;
      logger.info?.(
        `[webhook] issues.${action} delivery=${delivery} repo=${owner}/${repo} issue=${issueNumber}`
      );
      try {
        const enqueued =
          action === "reopened"
            ? await enqueueIssueReopened({ owner, repo, issueNumber, installationId, action })
            : await enqueueIssueTriage({ owner, repo, issueNumber, installationId, action });
        return c.json({ received: true, queued: true, jobId: enqueued.jobId, owner, repo, issueNumber, action, delivery }, 202);
      } catch (err: any) {
        logger.error?.(`[webhook] issue enqueue failed: ${err?.message ?? err} (jobId=${issueJobId({ owner, repo, issueNumber })})`);
        return c.json(
          { received: true, queued: false, error: "queue unavailable", owner, repo, issueNumber, action, delivery },
          202
        );
      }
    }

    if (!REVIEW_ACTIONS.has(action)) {
      return c.json({ received: true, skipped: `action=${action}` });
    }

    // Ignore bots / drafts / missing installation.
    if (payload?.sender?.type === "Bot") {
      return c.json({ received: true, skipped: "sender-is-bot" });
    }
    // PR lifecycle end: drop anything still queued for the SHA (no more
    // reviews will post against it).
    if (action === "closed") {
      const owner = payload.repository?.owner?.login;
      const repo = payload.repository?.name;
      const pullNumber = payload.pull_request?.number ?? payload.number;
      const headSha = payload.pull_request?.head?.sha;
      if (!owner || !repo || !pullNumber || !headSha) {
        return c.json({ error: "missing repo/pr identifiers" }, 400);
      }
      const dropped = await dropPRJob(prJobId({ owner, repo, pullNumber, headSha }));
      logger.info?.(
        `[webhook] pull_request.closed delivery=${delivery} repo=${owner}/${repo} pr=${pullNumber} dropped=${dropped}`
      );
      return c.json({ received: true, closed: true, dropped, pullNumber, delivery });
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
      // In-progress indication on the PR (best-effort; never blocks the 202).
      const startedId = await postStartedComment({ owner, repo, pullNumber, installationId, headSha });
      logger.info?.(`[webhook] queued job=${jobId} startedComment=${startedId ?? "none"}`);
      return c.json(
        { received: true, queued: true, jobId, owner, repo, pullNumber, headSha, action, delivery },
        202
      );
    } catch (err: any) {
      logger.error?.(`[webhook] enqueue failed: ${err?.message ?? err} (jobId=${prJobId({ owner, repo, pullNumber, headSha })})`);
      return c.json(
        { received: true, queued: false, error: "queue unavailable", owner, repo, pullNumber, headSha, action, delivery },
        202
      );
    }
  },
});
