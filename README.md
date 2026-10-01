# CodeSheriff

A GitHub App (built on [Mastra](https://mastra.ai/)) that reviews pull requests, replies to @mentions, and triages issues — checking each one against what the repo is actually building.

## What it does

- **PR reviews** — on `pull_request.opened` / `synchronize`, posts a structured review (score + verdict, critical/security/performance sections, inline comments for criticals) via the Reviews API. Clean PRs get coverage proof, not prose; model hiccups are salvaged, never silently stamped.
- **@mention replies** — `@xcodesheriff-bot` in any PR/issue thread gets a contextual reply (review-related mentions only). Structured reviews stay on the Reviews path; thread replies are plain comments.
- **Issue triage** — on `issues.opened`, classifies BUG / FEATURE / QUESTION / CHORE, judges ALIGNED / MISALIGNED / UNCLEAR against the repo's live vision (description + topics + README, never assumed), posts a verdict comment, and sets labels. Human comments trigger follow-up passes; closing drops queued work.
- **Live progress** — both pipelines stream events over SSE:
  - `GET /reviews/progress/:owner/:repo/:pullNumber`
  - `GET /triage/progress/:owner/:repo/:issueNumber`

## Prerequisites

- Bun, Redis (6.2+ in prod; local 6.0 works for dev), an `ngrok` (or similar) tunnel for webhooks
- A GitHub App with permissions **Pull requests / Issues: Read & write**, **Metadata: Read-only**, subscribed to **Pull request**, **Issues**, **Issue comment**, and **Pull request review comment** events
- Model gateway credentials for `ollama-cloud/gpt-oss:120b` (primary) with `nvidia/meta/muse-glimmer-30b` fallback

## Setup

```bash
cp .env.example .env   # fill in GITHUB_APP_ID, GITHUB_PRIVATE_KEY (\n-escaped PEM), GITHUB_WEBHOOK_SECRET
bun install
bun dev:all            # dev server (:4111) + queue worker
```

Point the App's (single) webhook URL at `https://<tunnel>/webhooks/github`
and subscribe it to **Pull request**, **Issues**, **Issue comment**, and
**Pull request review comment**. Comment events are relayed internally to
the channel adapter (`code-review-agent`), which owns @mention replies —
no second URL needed (a GitHub App exposes only one).
Find the bot's numeric id for `GITHUB_BOT_USER_ID` (loop prevention) with:

```bash
curl -s 'https://api.github.com/users/xcodesheriff-bot%5Bbot%5D' | grep '"id"'
```

## Scripts

| Command                | Purpose                                              |
| ---------------------- | ---------------------------------------------------- |
| `bun dev:all`          | dev server + worker (normal local run)               |
| `bun run dev`          | server only                                          |
| `bun run worker`       | worker only (`pr-review` + `issue-triage` queues)    |
| `bun run check:skills` | drift guard: on-disk SKILL.md vs inlined copies     |
| `bun run build`        | `mastra build`                                       |

> The worker is a plain `bun` process with no hot-reload — restart `dev:all`
> after any code change, or the worker keeps running stale code.

## How it's wired

```
GitHub webhook → /webhooks/github → BullMQ (pr-review / issue-triage)
    → worker → pr-review-workflow (fetch → categorize → review → aggregate → post)
             → issue-triage-agent (classify → vision check → verdict + labels)
```

- Agents: `code-review-agent` (tools + 3 review skills), `workflow-review-agent`
  (tool-less, structured JSON), `issue-triage-agent` (tools + 2 triage skills).
- Skills are inline `createSkill` copies (`src/mastra/skills/`); `check:skills`
  fails on drift from the on-disk sources.
- Shared `rallyaMemory` (repo-profile working memory) plus Redis Streams pub/sub
  so server + worker coordinate across processes.

## Docs

- `ROADMAP.md` — phased plan (fixes, hardening, mention-replies, triage, lifecycle)
- `IMPLEMENTATION_PLAN.md` — original PR-review pipeline spec
- `.env.example` — full env contract
