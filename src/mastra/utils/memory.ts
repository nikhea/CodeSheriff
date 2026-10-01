import { Memory } from "@mastra/memory";

/**
 * Shared memory for the Rallya agents.
 *
 * Two layers, each with deliberate scope:
 *
 * - **Observational memory (thread scope):** background Observer/Reflector
 *   compress each conversation's raw history into a dense observation log.
 *   Scoped per thread, so long door-ops or setup sessions stay coherent
 *   without polluting other conversations. Requires a `thread` id per call.
 * - **Working memory (resource scope):** persistent user/org profile shared
 *   across ALL threads of the same resource (user). The agent maintains it
 *   via the working-memory tool: default org/event slugs, timezone,
 *   notification and checkout preferences.
 *
 * Storage comes from the Mastra instance (LibSQL), which supports both the
 * observation log and the `mastra_resources` table working memory needs.
 * Calls should pass `{ resource, thread }` — resource identifies the user
 * (shared profile), thread isolates the conversation (own observations).
 *
 * The Observer/Reflector model is overridable via RALLYA_MEMORY_MODEL
 * (any `provider/model` id); it needs its own provider key.
 *
 * Thread titles are generated server-side (`generateTitle`): after the first
 * exchange Mastra summarizes the thread into a short title and persists it.
 * The title model is overridable via RALLYA_TITLE_MODEL — small/cheap is
 * fine, classification-style work only.
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
    },
    workingMemory: {
      enabled: true,
      scope: "resource",
      template: `# Organizer Profile
- **Name**:
- **Timezone**:
- **Default org** (slug):
- **Frequent events** (slugs):

## Preferences
- **Currency** (e.g. USD):
- **Communication style** (e.g. concise):

## Session state
- **Last task**:
- **Open questions**:
`,
    },
  },
});
