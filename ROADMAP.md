# CodeSheriff — Phased Plan: Fixes, Hardening, New Feat

> Created 2026-10-01. Status: `feat/review-progress` (streaming) committed as `59bbe8d`, tree clean.
> Branch stack: `feat/skills-autopost` → `feat/utils` → `main`, plus `feat/review-progress` floating.
> Each phase ships independently: implement → `tsc` + relevant check → commit → verify live.

## Track 1 — Fix review quality (thin/salvage reviews)

Root cause (verified): clean PRs make the aggregate model answer in prose; the
salvage path stamps hardcoded 7/COMMENT with empty sections
(`pr-review-workflow.ts:390-391`, `github-post.ts:149-153`).

### Phase F1 — Salvage parser
Parse score/verdict from salvaged prose (`/Quality Score:\s*(\d+)/i`,
`/Verdict:\s*(APPROVE|REQUEST_CHANGES|COMMENT)/i`) instead of hardcoded
7/COMMENT. Clamp score 1–10; fall back to 7/COMMIT only when unparseable.
Branch: `fix/salvage-quality` off `feat/review-progress`.
Verify: unit probe with the thin-review prose → score/verdict match text.

### Phase F2 — Coverage block
`buildBody` always lists files reviewed + skipped + review depth, so
no-findings reviews prove what was examined.
Verify: clean 3-file PR review shows file list.

### Phase F3 — Honesty marker
Append `> Note: synthesis fell back to model prose` when salvage fires, so
readers know sections are approximate.

### Phase F4 — Prompt hardening
Aggregate prompt: "even with zero findings, return the full JSON object."
Verify F1–F4 together: re-run a clean PR → score matches prose, coverage
present, no self-contradiction.

## Track 2 — Harden (close open loops)

### Phase H1 — Streaming live test
`59bbe8d` was only synthetically tested. Push a test commit, `curl -N`
`/reviews/progress/:owner/:repo/:pr`, confirm live events + placeholder
midpoint update land on the PR.

### Phase H2 — Secret rotation (security debt)
Webhook secret + private key were exposed in chat history. Rotate both in
GitHub App settings, update `.env`, delete stale `OPENAI_API_KEY=jfjd`
(nothing reads it).

### Phase H3 — Branch merges
Merge order: `feat/skills-autopost` → `feat/utils` → `main`, then rebase
`feat/review-progress` (+ fix branch) onto the result. All prior phases
must be green first.

## Track 3 — New feat: @mention replies (recommended)

### Phase N1 — Shared pubsub foundation
`pubsub: new RedisStreamsPubSub({ url: REDIS_URL })` on the Mastra instance
(`@mastra/redis-streams` dep). Channels/signals need cross-process leases
(server + worker). Flag: local Redis 6.0.16 → 6.2+ for prod.

### Phase N2 — GitHub channel adapter
`channels: { adapters: { github: createGitHubAdapter() } }` on
`code-review-agent` (`@chat-adapter/github` dep). Set `GITHUB_BOT_USERNAME`
+ numeric bot user ID (no self-reply loops). A GitHub App exposes ONE
webhook URL, so comment events land on `/webhooks/github` and are relayed
internally to the adapter (which no-ops on non-mentions); the auto-mounted
`/api/agents/code-review-agent/channels/github/webhook` is not pointed at
directly. Triage follow-ups yield to the adapter on mentions (no
double-replies).

### Phase N3 — Mention gating
Instructions: review-related mentions only. Structured reviews stay on the
Octokit Reviews path (adapter posts plain comments).
Verify: `@xcodesheriff-bot re-review` on a test PR → thread reply; no loops.

### Phase N4 — Lifecycle follow-ups (shipped webhook-driven, no provider)
`issue_comment` created (human → follow-up pass with comment context via
`getIssueComments`; full triage when never triaged), `issues.closed`
(drops queued triage/follow-up jobs), `issues.reopened` (re-triage),
`pull_request.closed` (drops queued review job). Triage streams
stage/tool/text events to `GET /triage/progress/:owner/:repo/:issue` (SSE,
Redis-backed, mirrors review progress). GithubSignals provider stays
deferred (needs gitcrawl+gh+sqlite3, 5-min poll, beta API).

## Execution order

F1 → F2 → F3 → F4 → H1 → H2 → H3 → N1 → N2 → N3 → (N4 later)
