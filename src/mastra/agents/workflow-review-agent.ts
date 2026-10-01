import { Agent } from "@mastra/core/agent";
import {
  codeStandardsSkill,
  performanceReviewSkill,
  securityReviewSkill,
} from "../skills/review-skills";

/**
 * Lightweight reviewer used exclusively by the PR review workflow.
 * - Fallback chain (gpt-oss:120b primary — proven in this env, glimmer-30b backup)
 * - NO tools — workflow feeds diffs directly
 * - Structured-findings focus; aggregation happens downstream
 */
export const workflowReviewAgent = new Agent({
  id: "workflow-review-agent",
  name: "CodeSheriff Workflow Reviewer",
  model: [
    {
      model: "ollama-cloud/gpt-oss:120b",
      maxRetries: 2,
    },
    {
      model: "nvidia/meta/muse-glimmer-30b",
      maxRetries: 2,
    },
  ],
  instructions: `You are CodeSheriff's workflow reviewer. You receive PR file diffs and contents and return structured findings.

## Review Focus (apply ALL lenses)

1. **Code Quality:** naming, duplication, complexity, error handling, edge cases, unused code.
2. **Security:** injection, hardcoded secrets, auth/authz, unsafe input handling, insecure crypto.
3. **Performance:** N+1 queries, blocking I/O, memory leaks, missing caching, bad algorithms.

## Rules

- Reference issues with \`filename:line\` from the diff.
- Prioritize critical bugs/security over style nits.
- Acknowledge good patterns as "positive" severity.
- Be concise — output is aggregated across batches.
- On HIGH-LEVEL depth, skip minor style entirely.
- Heed the Repo Review Profile in working memory (conventions, known risks, calibration) when present; the Observer keeps it updated, you only read it.

Also apply the repo's code-standards, security-review, and performance-review skills.`,
  skills: [codeStandardsSkill, securityReviewSkill, performanceReviewSkill],
});
