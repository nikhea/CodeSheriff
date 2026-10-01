import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  codeStandardsSkill,
  securityReviewSkill,
  performanceReviewSkill,
} from "../src/mastra/skills/review-skills";

/**
 * Guards against drift between the on-disk SKILL.md source of truth and the
 * inlined createSkill() copies the agent actually loads.
 * Usage: bun run check:skills (non-zero exit on drift)
 */
const SKILLS_ROOT = resolve(import.meta.dirname, "../src/mastra/skills");

function readSkillFile(path: string): string | null {
  try {
    return readFileSync(path, "utf-8").replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
  } catch {
    return null;
  }
}

function frontmatter(path: string): { name?: string; description?: string } | null {
  const text = readSkillFile(path);
  if (text === null) return null;
  const match = text.match(/^---\n([\s\S]*?)\n---/);
  const out: { name?: string; description?: string } = {};
  if (!match) return out;
  for (const line of match[1].split("\n")) {
    const name = line.match(/^name:\s*(.+)\s*$/);
    const desc = line.match(/^description:\s*(.+)\s*$/);
    if (name) out.name = name[1].trim();
    if (desc) out.description = desc[1].trim();
  }
  return out;
}

let failures = 0;
const fail = (msg: string) => {
  failures++;
  console.error(`DRIFT: ${msg}`);
};

for (const skill of [codeStandardsSkill, securityReviewSkill, performanceReviewSkill]) {
  const before = failures;
  const dir = resolve(SKILLS_ROOT, skill.name);
  const fm = frontmatter(resolve(dir, "SKILL.md"));
  if (fm === null) {
    fail(`${skill.name}: cannot read SKILL.md`);
  } else {
    if (!fm.name) fail(`${skill.name}: on-disk SKILL.md has no frontmatter name`);
    else if (fm.name !== skill.name) fail(`name mismatch: disk=${fm.name} inline=${skill.name}`);
    if (!fm.description) fail(`${skill.name}: on-disk SKILL.md has no description`);
    else if (fm.description !== skill.description)
      fail(`${skill.name}: description drift\n  disk:   ${fm.description}\n  inline: ${skill.description}`);
  }

  let refs: string[] = [];
  try {
    refs = readdirSync(resolve(dir, "references"));
  } catch {
    /* no references dir */
  }
  // NOTE: createSkill() normalizes `references` to a filename array on the
  // returned skill object (verified at runtime: ["style-guide.md"]). The
  // object-literal shape only exists in the createSkill() *input*.
  const inlineRefs: string[] = (skill as { references?: string[] }).references ?? [];
  for (const r of refs) {
    if (!inlineRefs.includes(r)) fail(`${skill.name}: references/${r} on disk but missing inline`);
  }
  for (const r of inlineRefs) {
    if (!refs.includes(r)) fail(`${skill.name}: inline reference ${r} has no on-disk file`);
  }
  if (failures === before) console.log(`ok: ${skill.name}`);
}

if (failures > 0) {
  console.error(`${failures} drift issue(s) found`);
  process.exit(1);
}
console.log("skills in sync");
