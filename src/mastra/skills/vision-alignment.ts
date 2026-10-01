import { createSkill } from "@mastra/core/skills";

export const visionAlignmentSkill = createSkill({
  name: "vision-alignment",
  description: "Methodology for judging whether a GitHub issue aligns with what a repo is building",
  instructions: `# Vision Alignment

Judge whether an issue serves what the repo declares it builds. Reference the rubric in \`references/alignment-rubric.md\`.

## Vision Source Hierarchy

Use the highest available source; never skip upward:

1. **Repo description** — one-line mission. Highest authority, lowest detail.
2. **Topics** — domain signals (e.g. \`code-review\`, \`github-bot\`).
3. **README.md** at the default branch — the stated vision. Features,
   scope, non-goals sections are binding; marketing fluff is not.
4. **Roadmap/plan docs** (e.g. ROADMAP.md) when present — in-progress
   direction. Nice-to-have, not required reading.

If no vision is stated anywhere (empty description, no README), say so
explicitly and judge from topics + issue merit only. Never hallucinate a
vision to justify a verdict.

## Verdicts

- **ALIGNED**: in-scope bug, fitting feature, answerable question, useful
  chore. Quote the vision line it serves.
- **MISALIGNED**: out-of-scope request, duplicate direction, contradicts a
  stated non-goal or scope. Quote the conflicting line. Suggesting closure
  is allowed; closing is not.
- **UNCLEAR**: body too thin to judge. Name the missing specifics. Never
  guess the reporter's intent to force a verdict.

## Quoting Rules

- Every alignment claim cites one fetched line (description, topic, or
  README quote). No quote → no alignment claim.
- Paraphrase is not a quote. If you can only paraphrase, the evidence is
  too weak — downgrade to UNCLEAR.`,
  references: {
    "alignment-rubric.md": `# Alignment Rubric

## Worked Examples

### ALIGNED feature

- Issue: "Support GitLab merge requests in addition to GitHub PRs"
- Vision: README "Supported platforms" lists "GitHub (GA), GitLab (planned)"
- Verdict: FEATURE — ALIGNED. Quote: "GitLab (planned)".

### MISALIGNED feature

- Issue: "Add a hosted dashboard with team analytics"
- Vision: README "Non-goals: no hosted service, runs as a GitHub App only"
- Verdict: FEATURE — MISALIGNED. Quote the non-goals line. Suggest closure.

### ALIGNED bug

- Issue: "@mention replies loop when bot quotes itself"
- Vision: description "PR review bot with @mention replies", topics include
  \`github-bot\`
- Verdict: BUG — ALIGNED. Core advertised behavior broken.

### UNCLEAR (thin body)

- Issue: title "broken", empty body
- Verdict: UNCLEAR. Ask: what broke, expected vs observed, repo/version
  context. No guessing.

## Downgrade Ladder

Strong quote → verdict with confidence. Weak/paraphrase-only evidence →
same verdict hedged, or drop one rung (ALIGNED → UNCLEAR). No evidence →
UNCLEAR, always. A forced verdict is a failed triage.
`,
  },
});
