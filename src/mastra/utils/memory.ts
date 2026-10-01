import { Memory } from "@mastra/memory";

/**
 * Shared memory for the CodeSheriff PR review agents.
 *
 * Two layers, each with deliberate scope:
 *
 * - **Observational memory (thread scope):** background Observer/Reflector
 *   compress each PR's raw diffs/tool results into a dense observation log.
 *   Scoped per PR thread (`pr-<owner>-<repo>-<n>`), so long reviews stay
 *   coherent without polluting other PRs. The Observer ALSO maintains
 *   working memory automatically (manageWorkingMemory) — the workflow
 *   agents use structured output (no tool calls), so they can't update it
 *   themselves.
 * - **Working memory (resource scope):** persistent repo review profile
 *   shared across ALL PR threads of the same repo (`repo-<owner>/<repo>`):
 *   conventions, known risk surfaces, author patterns, calibration.
 *   The agent reads it from context every run; the Observer keeps it fresh.
 *
 * Storage comes from the Mastra instance (LibSQL), which supports both the
 * observation log and the `mastra_resources` table working memory needs.
 * Workflow runs pass `{ resource, thread }` explicitly (see
 * generateStructured `memory` param); Studio chat manages its own.
 *
 * The Observer/Reflector model is overridable via RALLYA_MEMORY_MODEL
 * (any `provider/model` id); it needs its own provider key.
 */
export const rallyaMemory = new Memory({
  options: {
    lastMessages: 20,
    // Token budget over the full prompt (history + instructions + turn):
    // past maxTokens, oldest remembered messages drop in 2k chunks
    // (chunked removal keeps the prompt prefix cache-stable).
    messageHistory: { maxTokens: 8_000, atMaxRemoveTokens: 2_000 },
    // Server-side thread titles: summarized after the first exchange and
    // persisted on the thread. `emitEvent` also pushes a transient
    // `data-thread-title` chunk on the run stream so the web client can
    // rename the sidebar row live instead of polling.
    // generateTitle: {
    //   model:  "openrouter/google/gemma-4-31b-it:free",
    //   emitEvent: true,
    // },
    observationalMemory: {
      scope: "thread",
      model: "ollama-cloud/gpt-oss:120b",
      observation: {
        // Workflow agents use structured output (no tool calls), so they
        // can't update working memory themselves — the Observer does it.
        manageWorkingMemory: true,
      },
    },
    workingMemory: {
      enabled: true,
      scope: "resource",
      template: `# Repo Review Profile
- **Repo**:
- **Languages** (e.g. TypeScript, Python):
- **Conventions** (naming, structure, error handling):
- **Known risks** (auth surfaces, injection points, perf-sensitive paths):
- **Author patterns** (recurring issues by contributor):

## Calibration
- **Strictness** (e.g. strict on security, lenient on style):
- **Past verdicts** (e.g. PR #12 REQUEST_CHANGES for missing auth check):
`,
    },
  },
});
