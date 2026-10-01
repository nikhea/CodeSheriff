import { existsSync } from "node:fs";
import { resolve } from "node:path";

const SKILL_NAMES = ["code-standards", "security-review", "performance-review"] as const;

function skillFile(root: string, name: string): string {
  return resolve(root, name, "SKILL.md");
}

/**
 * Find the source skills root regardless of runtime:
 * - plain `bun src/...` → import.meta.dirname is src/mastra/agents
 * - `mastra dev` bundle → import.meta.dirname is .mastra/output
 * Probes ancestors of both the module dir and cwd for the source tree.
 */
export function resolveSkillsRoot(metaDir: string, cwd: string): string {
  const bases = [metaDir, cwd];
  for (const base of bases) {
    let dir = base;
    for (let depth = 0; depth < 5; depth++) {
      for (const root of [resolve(dir, "src/mastra/skills"), resolve(dir, "../skills")]) {
        if (SKILL_NAMES.every((n) => existsSync(skillFile(root, n)))) return root;
      }
      const parent = resolve(dir, "..");
      if (parent === dir) break;
      dir = parent;
    }
  }
  throw new Error(
    `[skills] source skills not found from metaDir=${metaDir} cwd=${cwd}. ` +
      `Expected src/mastra/skills/{${SKILL_NAMES.join(",")}} with SKILL.md files.`
  );
}

/** Absolute dir for one skill, resolved once at import. */
export function skillPath(name: (typeof SKILL_NAMES)[number]): string {
  return resolve(skillsRoot, name);
}

export const skillsRoot = resolveSkillsRoot(import.meta.dirname, process.cwd());
