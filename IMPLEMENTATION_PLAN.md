# CodeSheriff — PR Review Agent Implementation Plan

> Generated 2026-10-01. Weather agent/workflow untouched. No Workspace. Octokit-only.

## Shared understanding

- **Trigger:** GitHub App, `pull_request opened + synchronize`, `POST /webhooks/github` (`requiresAuth:false`), URL `https://<ngrok>/webhooks/github`. `ping` → 200.
- **Verify:** `c.req.text()` raw + `verify(secret, raw, sig)` from `@octokit/webhooks-methods`.
- **Auth:** `App({appId, privateKey: GITHUB_PRIVATE_KEY.replace(/\\n/g,'\n'), webhooks:{secret}})`, per-request `getInstallationOctokit(installationId)`.
- **Env:** required `GITHUB_APP_ID, GITHUB_PRIVATE_KEY (\n-escaped), GITHUB_WEBHOOK_SECRET` (fail fast where used, boot-logged via `lib/env.ts`); optional `REDIS_URL` (default localhost, graceful degrade), `GITHUB_INSTALLATION_ID` (Studio fallback only). No OpenAI.
- **Queue:** thin BullMQ `pr-review` (`jobId=pr-{repo}-{n}-{sha}`, attempts 3, concurrency 2) + direct-call fallback if Redis down.
- **Pipeline:** `fetch → categorize → review → aggregate → postReview`. Thresholds `SMALL=6 / MEDIUM=20`, batches `400k chars / 40 files`, `SKIP_PATTERNS`, deletion-only 50.
- **Agents:** `code-review (glimmer-30b → gpt-oss:120b fallback, 6 Octokit tools incl. postPRReview)` + `workflow-reviewer (same fallback chain, no tools)`, agent-level `skills: [code-standards, security-review, performance-review]`, shared `rallyaMemory` (observer `ollama-cloud/gpt-oss:120b`, working memory resource scope). No OpenAI anywhere.
- **Post:** Reviews API `commit_id=headSha`, marker `<!-- codesheriff:{sha} -->`, `event:COMMENT` always for v1, 422-tolerant inline. `opened` = summary + inline criticals, `synchronize` = upsert summary only. Ignore bot/draft/empty.
- **Infra:** local Redis (`redis-cli ping` → PONG), `ngrok http 4111` → Mastra dev `:4111`. `simple-git` installed but unused v1.

## Files to add (no weather edits)

- `src/mastra/lib/github-app.ts`
- `src/mastra/lib/schemas.ts` (copy template verbatim)
- `src/mastra/lib/review-config.ts` (copy template verbatim)
- `src/mastra/tools/github-pr.ts`
- `src/mastra/agents/code-review-agent.ts`
- `src/mastra/agents/workflow-review-agent.ts`
- `src/mastra/workflows/pr-review-workflow.ts`
- `src/mastra/queue/pr-queue.ts`
- `src/mastra/routes/github-webhook.ts`
- Wire `agents`, `workflows`, `server.apiRoutes` in `src/mastra/index.ts`

---

### Phase 1 — Config + GitHub App wiring (auth works)

**Achieves:** `getInstallationOctokit()` returns real install token.

- Add `src/mastra/lib/github-app.ts` (`getApp`, `getInstallationOctokit`, env fail-fast), `lib/review-config.ts` + `schemas.ts`.
- `.env`: `GITHUB_APP_ID, GITHUB_PRIVATE_KEY, GITHUB_WEBHOOK_SECRET` (+ optional `REDIS_URL, GITHUB_INSTALLATION_ID`).
- **Test:** `bun -e` call `getInstallationOctokit(ID).request('GET /app')` → app name.

### Phase 2 — Octokit tools + agents (manual review in Studio)

**Achieves:** paste PR URL in Studio → structured review, no webhook.

- Add `src/mastra/tools/github-pr.ts` (Octokit tools, `installationId` via `requestContext`), `agents/code-review-agent.ts` (fallback-chain models + 3 skills + shared `rallyaMemory`), `agents/workflow-review-agent.ts` (same chain, no tools).
- Register both in `src/mastra/index.ts` alongside weather.
- **Test:** Studio chat `Review owner/repo#123` → Summary / Assessment / Critical / Security / Performance.

### Phase 3 — Workflow core (fetch → aggregate, no posting)

**Achieves:** `pr-review-workflow.start({owner,repo,pullNumber})` → JSON review.

- Add `src/mastra/workflows/pr-review-workflow.ts` (4 steps: `fetchPRContext → categorizeFiles → reviewFiles → aggregateFindings`, depth 6/20, batches 400k/40).
- **Test:** Studio Workflows tab on small (≤6), medium, large PR → depth + skipped + cost.

### Phase 4 — Webhook ingress (GitHub → Mastra)

**Achieves:** opening test PR hits ngrok → 202 logged.

- Add `src/mastra/routes/github-webhook.ts` (`registerApiRoute('/webhooks/github', POST, requiresAuth:false)`, `c.req.text()` + `verify()`, `ping` handling, bot/draft/empty filter), wire `server.apiRoutes`.
- `ngrok http 4111`, App webhook URL `https://<ngrok>/webhooks/github`.
- **Test:** bad-sig → 401, open test PR → 202 + log `pull_request.opened sha=...`.

### Phase 5 — Queue + worker (durable execution)

**Achieves:** bursts + retries survive restarts, no duplicate jobs.

- Add `src/mastra/queue/pr-queue.ts` (Queue + Worker, `jobId=pr-{repo}-{n}-{sha}`, attempts 3, concurrency 2, fallback direct call).
- Handler enqueues, worker calls workflow with `requestContext{installationId}`.
- **Test:** push 3x fast → 1 job per SHA, kill worker mid-run → retry succeeds.

### Phase 6 — Posting (visible bot comments)

**Achieves:** bot comments appear on PR.

- Add final `postReview` step (Reviews API `commit_id=headSha`, marker `<!-- codesheriff:{sha} -->`, `event:COMMENT`, 422-tolerant).
- `opened` = summary + inline criticals, `synchronize` = upsert summary only.
- **Test:** open PR → summary + inline, push → same comment edited.

### Phase 7 — Hardening + bill guard

**Achieves:** safe to leave on.

- Timeouts 5min, `SKIP_PATTERNS` + deletion-only 50 enforced, large-PR HIGH-LEVEL only, Pino + observability kept.
- **Test:** 100-file PR → high-level only, bot/draft ignored.
