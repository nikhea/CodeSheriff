---
name: issue-triage
description: Issue classification and verdict mechanics for GitHub issue triage
version: 1.0.0
metadata:
  tags:
    - triage
    - github-issues
---

# Issue Triage

When a GitHub issue opens, classify it and produce a verdict. Reference the detailed checklist in `references/triage-checklist.md`.

## Type Taxonomy

- **BUG**: claims something already built is broken. Requires: observed vs
  expected behavior, steps or context to reproduce. A stack trace without
  context is a weak bug — ask for specifics.
- **FEATURE**: requests a new capability. Requires: the desired outcome and
  the problem it solves. "Add X" with no motivation is a weak feature.
- **QUESTION**: asks how to do something or whether something is supported.
  Answerable from docs/README → answer inline. Not answerable → UNCLEAR.
- **CHORE**: dependencies, docs, housekeeping, CI. Judge by usefulness,
  not excitement.

## Distinguishing Tests

- Bug or feature? "X doesn't work" = BUG. "X should exist" = FEATURE.
  "X works but badly" = BUG if regressed, FEATURE if never supported.
- Feature or chore? User-facing capability = FEATURE. Repo hygiene = CHORE.
- Anything abusive, spam, or empty → UNCLEAR with a one-line note; never
  invent content to rescue it.

## Verdict Mechanics

- Post the verdict comment exactly once; it IS the deliverable.
- Set labels exactly once: keep existing labels, add one alignment label
  (`triaged-aligned` / `triaged-misaligned` / `triaged-unclear`) and one
  type label (`bug` / `enhancement` / `question` / `chore`).
- Never close issues. Suggest closure for out-of-scope; closing stays human.
