import { createWorkflow, createStep } from "@mastra/core/workflows";
import { z } from "zod";
import { getInstallationOctokit, getTestInstallationId } from "../lib/github-app";
import {
  prIdentifierSchema,
  prSchema,
  fileSchema,
  fileReviewSchema,
  aggregateSummarySchema,
  reviewOutputSchema,
} from "../lib/schemas";
import { SKIP_PATTERNS, MEDIUM_PR_MAX, getReviewDepth, MIN_DELETION_ONLY_LINES } from "../lib/review-config";
import { postReviewToGitHub, updateProgressComment } from "../lib/github-post";
import { generateStructured } from "../lib/structured";
import { emitProgress, type ReviewEvent } from "../lib/review-events";

/** Memory identity for a PR run: thread per PR, resource per repo. */
function prMemory(owner: string, repo: string, pullNumber: number) {
  return {
    thread: `pr-${owner}-${repo}-${pullNumber}`,
    resource: `repo-${owner}/${repo}`,
  };
}

/** Max total chars across all files in a single agent call. */
const BATCH_CHAR_BUDGET = 400_000;
/** Max files per agent call. */
const BATCH_FILE_LIMIT = 40;
/** Hard cap on files sent for review — extras land in skippedFiles. Bounds model cost on huge PRs. */
const MAX_REVIEW_FILES = 100;

/** installationId comes from workflow requestContext (worker/webhook); env fallback for Studio. */
function resolveInstallationId(requestContext?: any): number {
  const fromCtx = requestContext?.get?.("installationId") as number | undefined;
  const id = fromCtx ?? getTestInstallationId();
  if (!id) {
    throw new Error(
      "Missing installationId. Start workflow with requestContext { installationId } or set GITHUB_INSTALLATION_ID for Studio tests."
    );
  }
  return id;
}

async function fetchAllPRFiles(octokit: any, owner: string, repo: string, pullNumber: number) {
  const all: any[] = [];
  let page = 1;
  while (true) {
    const { data } = await octokit.request("GET /repos/{owner}/{repo}/pulls/{pull_number}/files", {
      owner, repo, pull_number: pullNumber, per_page: 100, page,
    });
    if (data.length === 0) break;
    all.push(
      ...data.map((f: any) => ({
        filename: f.filename as string,
        status: f.status as string,
        additions: f.additions as number,
        deletions: f.deletions as number,
        changes: f.changes as number,
        ...(f.patch !== undefined ? { patch: f.patch as string } : {}),
      }))
    );
    if (data.length < 100) break;
    page++;
  }
  return all;
}

async function fetchFileContent(octokit: any, owner: string, repo: string, path: string, ref: string) {
  try {
    const { data }: any = await octokit.request("GET /repos/{owner}/{repo}/contents/{path}", {
      owner, repo, path, ref,
    });
    if (data.type !== "file" || !data.content) return null;
    return Buffer.from(data.content, "base64").toString("utf-8");
  } catch (err: any) {
    if (err?.status === 404) return null;
    throw err;
  }
}

const prBaseSchema = z.object({
  owner: z.string(),
  repo: z.string(),
  pullNumber: z.number(),
  pr: prSchema,
});

const prContextSchema = prBaseSchema.extend({ files: z.array(fileSchema) });
const categorizedSchema = prBaseSchema.extend({
  reviewableFiles: z.array(fileSchema),
  skippedFiles: z.array(z.string()),
});
const reviewedSchema = prBaseSchema.extend({
  fileReviews: z.array(fileReviewSchema),
  skippedFiles: z.array(z.string()),
});

const postedSchema = z.object({
  posted: z.boolean(),
  reviewId: z.number().nullable(),
  mode: z.string(),
  inlineCount: z.number(),
});

// aggregateFindings carries identifiers forward so postReview knows where to post.
const aggregatedSchema = prBaseSchema.extend(aggregateSummarySchema.shape).extend({
  fileReviews: z.array(fileReviewSchema),
  skippedFiles: z.array(z.string()),
});

const finalOutputSchema = aggregatedSchema.extend({ posted: postedSchema });

/**
 * Build a review summary from salvaged model prose. Extracts the model's own
 * score/verdict instead of stamping defaults — a hardcoded 7/COMMENT over
 * model prose produces self-contradicting reviews.
 */
export function parseSalvagedReview(prose: string): z.infer<typeof aggregateSummarySchema> {
  const empty = {
    criticalIssues: [],
    securityConcerns: [],
    performanceNotes: [],
    suggestions: [],
    positiveNotes: [],
  };
  const scoreMatch = prose.match(/Quality Score:\s*(\d{1,2})/i);
  const verdictMatch = prose.match(/Verdict:\s*(APPROVE|REQUEST_CHANGES|COMMENT)/i);
  let qualityScore = 7;
  if (scoreMatch) qualityScore = Math.min(10, Math.max(1, parseInt(scoreMatch[1], 10)));
  const v = verdictMatch?.[1]?.toUpperCase();
  const verdict = (v === "APPROVE" || v === "REQUEST_CHANGES" ? v : "COMMENT") as
    | "APPROVE"
    | "REQUEST_CHANGES"
    | "COMMENT";
  const summary =
    prose.slice(0, 4000) +
    "\n\n> Note: score and verdict were recovered from model prose (structured synthesis failed).";
  return { summary, qualityScore, verdict, ...empty };
}

const fetchPRContext = createStep({
  id: "fetch-pr-context",
  description: "Fetch PR metadata and file list via Octokit installation auth",
  inputSchema: prIdentifierSchema,
  outputSchema: prContextSchema,
  execute: async ({ inputData, requestContext, writer }) => {
    const { owner, repo, pullNumber } = inputData;
    const octokit = await getInstallationOctokit(resolveInstallationId(requestContext));
    const [{ data: pr }, files] = await Promise.all([
      octokit.request("GET /repos/{owner}/{repo}/pulls/{pull_number}", {
        owner, repo, pull_number: pullNumber,
      }),
      fetchAllPRFiles(octokit, owner, repo, pullNumber),
    ]);
    await emitProgress(writer, owner, repo, pullNumber, { type: "started", pr: pullNumber });
    await emitProgress(writer, owner, repo, pullNumber, {
      type: "analysis",
      message: `Fetched "${pr.title}" by ${pr.user?.login ?? "ghost"}: +${pr.additions}/-${pr.deletions} across ${pr.changed_files} files`,
    });
    return {
      owner,
      repo,
      pullNumber,
      pr: {
        title: pr.title,
        body: pr.body ?? null,
        state: pr.state,
        author: pr.user?.login ?? "ghost",
        baseBranch: pr.base.ref,
        headBranch: pr.head.ref,
        headSha: pr.head.sha,
        labels: (pr.labels ?? []).map((l: any) => (typeof l === "string" ? l : l.name)),
        createdAt: pr.created_at,
        updatedAt: pr.updated_at,
        additions: pr.additions,
        deletions: pr.deletions,
        changedFiles: pr.changed_files,
      },
      files,
    };
  },
});

const categorizeFiles = createStep({
  id: "categorize-files",
  description: "Filter non-reviewable files",
  inputSchema: prContextSchema,
  outputSchema: categorizedSchema,
  execute: async ({ inputData }) => {
    const reviewableFiles: z.infer<typeof fileSchema>[] = [];
    const skippedFiles: string[] = [];

    for (const file of inputData.files) {
      if (SKIP_PATTERNS.some((p) => p.test(file.filename))) {
        skippedFiles.push(file.filename);
      } else if (file.additions === 0 && file.deletions < MIN_DELETION_ONLY_LINES) {
        skippedFiles.push(file.filename);
      } else {
        reviewableFiles.push(file);
      }
    }

    const { owner, repo, pullNumber, pr } = inputData;
    if (reviewableFiles.length > MAX_REVIEW_FILES) {
      const extras = reviewableFiles.splice(MAX_REVIEW_FILES);
      for (const f of extras) skippedFiles.push(`${f.filename} (over ${MAX_REVIEW_FILES}-file cap)`);
    }
    return { owner, repo, pullNumber, pr, reviewableFiles, skippedFiles };
  },
});

type FileEntry = z.infer<typeof fileSchema> & { content: string };

function buildFileSection(f: FileEntry, includeContent: boolean): string {
  let s = `### ${f.filename} (${f.status}, +${f.additions}/-${f.deletions})\n`;
  if (f.patch) s += `\n**Diff:**\n\`\`\`diff\n${f.patch}\n\`\`\`\n`;
  if (includeContent && f.content) s += `\n**Full file:**\n\`\`\`\n${f.content}\n\`\`\`\n`;
  return s;
}

function batchFiles(files: FileEntry[], includeContent: boolean): FileEntry[][] {
  const batches: FileEntry[][] = [];
  let batch: FileEntry[] = [];
  let chars = 0;

  for (const f of files) {
    const size = buildFileSection(f, includeContent).length;
    if (batch.length > 0 && (chars + size > BATCH_CHAR_BUDGET || batch.length >= BATCH_FILE_LIMIT)) {
      batches.push(batch);
      batch = [];
      chars = 0;
    }
    batch.push(f);
    chars += size;
  }
  if (batch.length > 0) batches.push(batch);
  return batches;
}

const reviewFiles = createStep({
  id: "review-files",
  description: "Review files using the workflow reviewer (batched for large PRs)",
  inputSchema: categorizedSchema,
  outputSchema: reviewedSchema,
  execute: async ({ inputData, mastra, requestContext, writer }) => {
    const { owner, repo, pullNumber, pr, reviewableFiles, skippedFiles } = inputData;
    const agent = mastra.getAgentById("workflow-review-agent");

    // Empty PR (or everything filtered): skip model calls entirely.
    if (reviewableFiles.length === 0) {
      return { owner, repo, pullNumber, pr, fileReviews: [], skippedFiles };
    }

    const includeContent = reviewableFiles.length <= MEDIUM_PR_MAX;
    const reviewDepth = getReviewDepth(reviewableFiles.length);
    const octokit = await getInstallationOctokit(resolveInstallationId(requestContext));

    const entries: FileEntry[] = includeContent
      ? await Promise.all(
          reviewableFiles.map(async (file) => ({
            ...file,
            content: (await fetchFileContent(octokit, owner, repo, file.filename, pr.headSha)) ?? "",
          }))
        )
      : reviewableFiles.map((f) => ({ ...f, content: "" }));

    const batches = batchFiles(entries, includeContent);
    await emitProgress(writer, owner, repo, pullNumber, {
      type: "analysis",
      message: `Reviewing ${entries.length} files in ${batches.length} batch(es) (${reviewDepth.split(" — ")[0]})`,
    });

    // Batches are independent — always run in parallel. (Sequential only
    // throttles wall-clock; rate limits are guarded by the queue limiter.)
    const MAX_STREAMED_FINDINGS = 30;
    let streamedFindings = 0;
    let midpointNoted = false;

    function findingSeverity(s: string): "info" | "warning" | "error" {
      return s === "critical" ? "error" : s === "warning" ? "warning" : "info";
    }

    function buildPrompt(batch: FileEntry[], batchIndex: number): string {
      const label =
        batches.length === 1
          ? `Files to Review (${entries.length} files)`
          : `Batch ${batchIndex + 1}/${batches.length} (${batch.length} files)`;
      const sections = batch.map((f) => buildFileSection(f, includeContent)).join("\n---\n\n");
      return `Review the following PR files. Apply all review skills (code-standards, security-review, performance-review).

## PR Context
- **Title:** ${pr.title}
- **Author:** ${pr.author}
- **Branch:** ${pr.headBranch} → ${pr.baseBranch}
- **Description:** ${pr.body || "(no description)"}
- **Stats:** +${pr.additions}/-${pr.deletions} across ${pr.changedFiles} files

## Review Depth
${reviewDepth}

## ${label}

${sections}

For EACH file, return an entry with the filename and an array of issues found (empty array if none). Be specific with line numbers from the diff. Even with zero findings, return the full JSON array — never prose.`;
    }

    async function reviewBatch(batch: FileEntry[], idx: number) {
      return generateStructured<z.infer<typeof fileReviewSchema>[]>(
        agent,
        buildPrompt(batch, idx),
        z.array(fileReviewSchema),
        [],
        `review-batch-${idx + 1}/${batches.length}`,
        mastra?.getLogger?.(),
        undefined,
        30,
        prMemory(owner, repo, pullNumber)
      );
    }

    let allReviews: z.infer<typeof fileReviewSchema>[];
    const results = await Promise.all(
      batches.map(async (batch, i) => {
        for (const f of batch) {
          await emitProgress(writer, owner, repo, pullNumber, { type: "file", path: f.filename });
        }
        const reviews = await reviewBatch(batch, i);
        for (const fr of reviews) {
          for (const issue of fr.issues) {
            if (streamedFindings >= MAX_STREAMED_FINDINGS) break;
            streamedFindings++;
            await emitProgress(writer, owner, repo, pullNumber, {
              type: "finding",
              severity: findingSeverity(issue.severity),
              message: `${fr.filename}${issue.line ? `:${issue.line}` : ""} — ${issue.message}`,
            });
          }
        }
        // One GitHub placeholder refresh per run (after the first batch lands).
        if (!midpointNoted) {
          midpointNoted = true;
          const done = batch.length;
          await updateProgressComment(
            octokit, owner, repo, pullNumber, pr.headSha,
            `🔍 **CodeSheriff** reviewing… (${done}/${entries.length} files scanned, ${streamedFindings} findings so far)`
          );
        }
        return reviews;
      })
    );
    allReviews = results.flat();

    return { owner, repo, pullNumber, pr, fileReviews: allReviews, skippedFiles };
  },
});

const aggregateFindings = createStep({
  id: "aggregate-findings",
  description: "Synthesize per-file reviews into a cohesive PR review summary",
  inputSchema: reviewedSchema,
  outputSchema: aggregatedSchema,
  execute: async ({ inputData, mastra, writer }) => {
    const { owner, repo, pullNumber, pr, fileReviews, skippedFiles } = inputData;
    const agent = mastra.getAgentById("workflow-review-agent");

    const issuesSummary = fileReviews
      .filter((fr) => fr.issues.length > 0)
      .map((fr) => {
        const issues = fr.issues
          .map(
            (i) => `  - [${i.severity}/${i.category}] ${i.line ? `${fr.filename}:${i.line}` : fr.filename}: ${i.message}`
          )
          .join("\n");
        return `**${fr.filename}:**\n${issues}`;
      })
      .join("\n\n");

    const prompt = `Synthesize a final PR review from the per-file findings below.

## PR Info
- **Title:** ${pr.title}
- **Author:** ${pr.author}
- **Description:** ${pr.body || "(no description)"}
- **Stats:** +${pr.additions}/-${pr.deletions} across ${pr.changedFiles} files

## Per-File Findings
${issuesSummary || "No issues found in any file."}

## Skipped Files
${skippedFiles.length > 0 ? skippedFiles.join(", ") : "None"}

Rules:
- qualityScore: 1–10
- verdict: REQUEST_CHANGES if critical issues exist, APPROVE if quality is high, COMMENT otherwise
- Be specific with file:line references
- Deduplicate similar issues across files
- Even with zero findings, return the full JSON object — never prose
- The JSON object MUST have exactly these keys: summary (string),
  qualityScore (number), verdict (string), criticalIssues (string[]),
  securityConcerns (string[]), performanceNotes (string[]),
  suggestions (string[]), positiveNotes (string[]). Use empty arrays —
  never omit a key, never null.
- NEVER emit an "issues" key — that belongs to per-file reviews, not this
  synthesis. If there is nothing to flag, return empty arrays with a
  one-sentence summary saying so.`;

    const summary = await generateStructured<z.infer<typeof aggregateSummarySchema>>(
      agent,
      prompt,
      aggregateSummarySchema,
      {
        summary: "Review could not be generated.",
        qualityScore: 5,
        verdict: "COMMENT" as const,
        criticalIssues: [],
        securityConcerns: [],
        performanceNotes: [],
        suggestions: [],
        positiveNotes: [],
      },
      "aggregate-findings",
      mastra?.getLogger?.(),
      // If the model answered in prose, salvage its own score/verdict
      // rather than stamping defaults over its words.
      (prose) => parseSalvagedReview(prose),
      30,
      prMemory(owner, repo, pullNumber)
    );

    await emitProgress(writer, owner, repo, pullNumber, {
      type: "analysis",
      message: `Synthesis complete: ${summary.qualityScore}/10 ${summary.verdict}`,
    });

    return { owner, repo, pullNumber, pr, ...summary, fileReviews, skippedFiles };
  },
});

const postReview = createStep({
  id: "post-review",
  description: "Post summary + inline review to GitHub via Reviews API (COMMENT only for v1)",
  inputSchema: aggregatedSchema,
  outputSchema: finalOutputSchema,
  execute: async ({ inputData, requestContext, mastra, writer }) => {
    const logger = mastra?.getLogger?.() ?? console;
    const { owner, repo, pullNumber, pr, fileReviews, skippedFiles, ...summary } = inputData as any;

    // Studio manual runs (no webhook action) default to dry-run: never post real comments by accident.
    const action = (requestContext?.get?.("action") as string | undefined) ?? "manual";
    if (action === "manual") {
      logger.info?.(`[post-review] dry-run repo=${owner}/${repo} pr=${pullNumber} (no webhook action)`);
      await emitProgress(writer, owner, repo, pullNumber, {
        type: "completed",
        summary: `(dry run) ${String(summary.summary ?? "").slice(0, 500)}`,
      });
      return {
        ...summary, fileReviews, skippedFiles,
        posted: { posted: false, reviewId: null, mode: "dry-run", inlineCount: 0 },
      };
    }

    const installationId = resolveInstallationId(requestContext);
    try {
      const result = await postReviewToGitHub({
        installationId, owner, repo, pullNumber, headSha: pr.headSha, action,
        summary: summary.summary, qualityScore: summary.qualityScore, verdict: summary.verdict,
        criticalIssues: summary.criticalIssues, securityConcerns: summary.securityConcerns,
        performanceNotes: summary.performanceNotes, suggestions: summary.suggestions,
        positiveNotes: summary.positiveNotes, skippedFiles, fileReviews,
      });
      logger.info?.(`[post-review] posted repo=${owner}/${repo} pr=${pullNumber} review=${result.reviewId} mode=${result.mode} inline=${result.inlineCount}`);
      await emitProgress(writer, owner, repo, pullNumber, {
        type: "completed",
        summary: `${summary.verdict} ${summary.qualityScore}/10 — review ${result.reviewId} posted (${result.mode}, ${result.inlineCount} inline)`,
      });
      return { ...summary, fileReviews, skippedFiles, posted: result };
    } catch (err: any) {
      // Never fail the workflow on posting errors — review data is still returned.
      logger.error?.(`[post-review] failed repo=${owner}/${repo} pr=${pullNumber}: ${err?.message ?? err}`);
      await emitProgress(writer, owner, repo, pullNumber, {
        type: "completed",
        summary: `Posting failed (${err?.message ?? err}); review data retained`,
      });
      return {
        ...summary, fileReviews, skippedFiles,
        posted: { posted: false, reviewId: null, mode: "failed", inlineCount: 0 },
      };
    }
  },
});

export const prReviewWorkflow = createWorkflow({
  id: "pr-review-workflow",
  description: "Structured PR review: fetch → categorize → review → aggregate → post",
  inputSchema: prIdentifierSchema,
  outputSchema: finalOutputSchema,
})
  .then(fetchPRContext)
  .then(categorizeFiles)
  .then(reviewFiles)
  .then(aggregateFindings)
  .then(postReview)
  .commit();
