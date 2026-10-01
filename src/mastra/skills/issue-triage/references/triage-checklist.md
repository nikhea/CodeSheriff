# Triage Checklist

## Before Any Verdict

- [ ] Fetched the issue via tool (`getIssue`) — never triage from hearsay
- [ ] Fetched the repo vision (`getRepository` + README via `getFileContent`)
- [ ] Read the full issue body, not just the title
- [ ] Checked existing labels before overwriting (keep + add, never wipe)

## Classification

- [ ] Applied the distinguishing tests (bug vs feature vs chore)
- [ ] Weak evidence noted explicitly (missing repro, missing motivation)
- [ ] Empty/abusive body → UNCLEAR, one line, no invented details

## Alignment

- [ ] Every alignment claim quotes a fetched vision line (see vision-alignment)
- [ ] MISALIGNED cites the specific conflict, not vibes
- [ ] UNCLEAR asks for named specifics, not "more info"

## Posting

- [ ] Verdict comment posted exactly once with type + alignment headline
- [ ] Labels set exactly once (alignment + type, existing kept)
- [ ] No close action taken
