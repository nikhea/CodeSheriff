/**
 * Barrel for the inline triage skills (one file per skill).
 *
 * Same convention as review-skills.ts: skills are INLINE (createSkill) so
 * they travel inside the bundle. Source of truth for content: the on-disk
 * SKILL.md files + references/ under src/mastra/skills/<name>/. Run
 * `bun run check:skills` to verify the inlined copies haven't drifted.
 */
export { issueTriageSkill } from "./issue-triage";
export { visionAlignmentSkill } from "./vision-alignment";
