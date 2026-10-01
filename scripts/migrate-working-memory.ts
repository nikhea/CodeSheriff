import { Database } from "bun:sqlite";

/**
 * One-shot migration: replaces stale Organizer-shaped working memory with the
 * Repo Review Profile template, preserving the last-task note as a past
 * verdict seed. Safe to re-run (only touches rows containing the old header).
 * Usage: bun scripts/migrate-working-memory.ts
 */
const NEW_TEMPLATE = (pastVerdicts: string) => `# Repo Review Profile
- **Repo**:
- **Languages** (e.g. TypeScript, Python):
- **Conventions** (naming, structure, error handling):
- **Known risks** (auth surfaces, injection points, perf-sensitive paths):
- **Author patterns** (recurring issues by contributor):

## Calibration
- **Strictness** (e.g. strict on security, lenient on style):
- **Past verdicts** (e.g. PR #12 REQUEST_CHANGES for missing auth check):
${pastVerdicts}`;

const DBS = ["./mastra.db", "src/mastra/public/mastra.db"];

for (const f of DBS) {
  let db: Database;
  try {
    db = new Database(f);
  } catch (err: any) {
    console.log(`skip ${f}: ${err?.message ?? err}`);
    continue;
  }
  const rows = db
    .query("SELECT id, workingMemory FROM mastra_resources WHERE workingMemory LIKE '%Organizer Profile%'")
    .all() as Array<{ id: string; workingMemory: string }>;
  if (rows.length === 0) {
    console.log(`ok ${f}: nothing to migrate`);
    continue;
  }
  for (const r of rows) {
    const lastTask = r.workingMemory.match(/- \*\*Last task\*\*:([\s\S]*?)(?:\n- \*\*Open questions\*\*:.*)?$/);
    const seed = lastTask?.[1]?.trim() ? `  - Carried over: ${lastTask[1].trim().slice(0, 500)}` : `  - (none yet)`;
    db.query("UPDATE mastra_resources SET workingMemory = ?, updatedAt = ? WHERE id = ?").run(
      NEW_TEMPLATE(seed),
      new Date().toISOString(),
      r.id
    );
    console.log(`migrated ${r.id} in ${f}`);
  }
  db.close();
}
