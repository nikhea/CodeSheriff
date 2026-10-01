# Alignment Rubric

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
  `github-bot`
- Verdict: BUG — ALIGNED. Core advertised behavior broken.

### UNCLEAR (thin body)

- Issue: title "broken", empty body
- Verdict: UNCLEAR. Ask: what broke, expected vs observed, repo/version
  context. No guessing.

## Downgrade Ladder

Strong quote → verdict with confidence. Weak/paraphrase-only evidence →
same verdict hedged, or drop one rung (ALIGNED → UNCLEAR). No evidence →
UNCLEAR, always. A forced verdict is a failed triage.
