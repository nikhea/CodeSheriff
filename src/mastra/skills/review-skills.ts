/**
 * Barrel for the inline review skills (one file per skill).
 *
 * Skills are INLINE (createSkill) so they travel inside the bundle —
 * filesystem skill paths resolve differently under `bun src/...` vs the
 * `mastra dev` bundle and silently failed to load in Studio.
 *
 * Source of truth for content: the on-disk SKILL.md files + references/
 * under src/mastra/skills/<name>/. Run `bun run check:skills` to verify
 * the inlined copies haven't drifted.
 */
export { codeStandardsSkill } from "./code-standards";
export { securityReviewSkill } from "./security-review";
export { performanceReviewSkill } from "./performance-review";
