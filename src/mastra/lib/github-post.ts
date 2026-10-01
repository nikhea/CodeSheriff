import { getInstallationOctokit } from "./github-app";

/** Marker embedded in review bodies for dedupe/tracing. */
export function reviewMarker(sha: string): string {
  return `<!-- codesheriff-review ${sha} -->`;
}

function parseLine(line?: string): number | null {
  if (!line) return null;
  const m = String(line).match(/(\d+)/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export interface PostReviewInput {
  installationId: number;
  owner: string;
  repo: string;
  pullNumber: number;
  headSha: string;
  action?: string;
  summary: string;
  qualityScore: number;
  verdict: string;
  criticalIssues: string[];
  securityConcerns: string[];
  performanceNotes: string[];
  suggestions: string[];
  positiveNotes: string[];
  skippedFiles: string[];
  fileReviews: Array<{
    filename: string;
    issues: Array<{ severity: string; category: string; line?: string; message: string }>;
  }>;
}

function buildBody(input: PostReviewInput, mode: string): string {
  const lines = [
    `## CodeSheriff Review ${mode === "summary-only" ? "(update)" : ""}`.trim(),
    ``,
    input.summary,
    ``,
    `**Score:** ${input.qualityScore}/10 — **${input.verdict}** (v1 posts COMMENT only, non-blocking)`,
    ``,
  ];
  const section = (title: string, items: string[]) => {
    if (!items.length) return;
    lines.push(`### ${title}`, ``, ...items.map((i) => `- ${i}`), ``);
  };
  section("Critical Issues 🔴", input.criticalIssues);
  section("Security Concerns 🟠", input.securityConcerns);
  section("Performance Notes 🟡", input.performanceNotes);
  section("Suggestions 💡", input.suggestions);
  section("Positive Notes ✅", input.positiveNotes);
  if (input.skippedFiles.length) {
    lines.push(`<details><summary>Skipped files (${input.skippedFiles.length})</summary>`, ``, input.skippedFiles.map((f) => `- \`${f}\``).join("\n"), `</details>`, ``);
  }
  lines.push(reviewMarker(input.headSha));
  return lines.join("\n");
}

/**
 * Post via Reviews API, always COMMENT for v1 (non-blocking).
 * - opened/reopened/ready_for_review/manual-webhook: summary + inline criticals/warnings (cap 10)
 * - synchronize: summary-only (no inline, avoids hunk-shift 422s + spam)
 * Never throws on GitHub 422s — drops bad inline comments and continues.
 */
export async function postReviewToGitHub(input: PostReviewInput): Promise<{
  posted: boolean;
  reviewId: number | null;
  mode: string;
  inlineCount: number;
}> {
  const octokit = await getInstallationOctokit(input.installationId);
  const action = input.action ?? "manual";
  const summaryOnly = action === "synchronize";
  const mode = summaryOnly ? "summary-only" : "full";

  const comments: Array<{ path: string; line: number; side: "RIGHT"; body: string }> = [];
  if (!summaryOnly) {
    for (const fr of input.fileReviews) {
      for (const issue of fr.issues) {
        if (issue.severity !== "critical" && issue.severity !== "warning") continue;
        const line = parseLine(issue.line);
        if (line === null) continue; // no mappable line → stays in summary sections
        if (comments.length >= 10) break;
        comments.push({
          path: fr.filename,
          line,
          side: "RIGHT",
          body: `**[${issue.severity}/${issue.category}]** ${issue.message}`,
        });
      }
      if (comments.length >= 10) break;
    }
  }

  const body = buildBody(input, mode);

  try {
    const { data } = await octokit.request("POST /repos/{owner}/{repo}/pulls/{pull_number}/reviews", {
      owner: input.owner,
      repo: input.repo,
      pull_number: input.pullNumber,
      commit_id: input.headSha,
      event: "COMMENT",
      body,
      comments: comments as any,
    });
    return { posted: true, reviewId: (data as any)?.id ?? null, mode, inlineCount: comments.length };
  } catch (err: any) {
    // Fallback: summary as issue comment (no inline) so the review isn't lost.
    if (err?.status === 422 && comments.length > 0) {
      const { data } = await octokit.request("POST /repos/{owner}/{repo}/pulls/{pull_number}/reviews", {
        owner: input.owner,
        repo: input.repo,
        pull_number: input.pullNumber,
        commit_id: input.headSha,
        event: "COMMENT",
        body: body + `\n\n> Note: ${comments.length} inline comment(s) omitted (lines not in diff).`,
      });
      return { posted: true, reviewId: (data as any)?.id ?? null, mode: "summary-only", inlineCount: 0 };
    }
    throw err;
  }
}
