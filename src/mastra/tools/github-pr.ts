import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { getInstallationOctokit, getTestInstallationId } from "../lib/github-app";
import { prIdentifierSchema, prSchema, fileSchema } from "../lib/schemas";
import { SKIP_PATTERNS } from "../lib/review-config";

/** Resolve installationId: workflow requestContext first, env fallback for Studio manual runs. */
async function resolveOctokit(context?: { requestContext?: any }) {
  const fromCtx = context?.requestContext?.get?.("installationId") as number | undefined;
  const installationId = fromCtx ?? getTestInstallationId();
  if (!installationId) {
    throw new Error(
      "Missing installationId. Pass requestContext { installationId } from webhook/worker, or set GITHUB_INSTALLATION_ID for local Studio tests."
    );
  }
  return getInstallationOctokit(installationId);
}

export const parseGitHubPRUrl = createTool({
  id: "parse-github-pr-url",
  description: "Parse a GitHub Pull Request URL into owner, repo, pullNumber.",
  inputSchema: z.object({
    url: z.string().describe("e.g. https://github.com/owner/repo/pull/123"),
  }),
  outputSchema: prIdentifierSchema,
  execute: async (inputData) => {
    const match = inputData.url.match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)\/?$/);
    if (!match) throw new Error(`Invalid PR URL: "${inputData.url}". Expected https://github.com/owner/repo/pull/123`);
    return { owner: match[1], repo: match[2], pullNumber: parseInt(match[3], 10) };
  },
});

export const getPullRequest = createTool({
  id: "get-pull-request",
  description: "Fetch PR metadata (title, body, author, branches, headSha, stats) via Octokit installation auth.",
  inputSchema: prIdentifierSchema,
  outputSchema: prSchema,
  execute: async (inputData, context) => {
    const octokit = await resolveOctokit(context);
    const { data } = await octokit.request("GET /repos/{owner}/{repo}/pulls/{pull_number}", {
      owner: inputData.owner,
      repo: inputData.repo,
      pull_number: inputData.pullNumber,
    });
    return {
      title: data.title,
      body: data.body ?? null,
      state: data.state,
      author: data.user?.login ?? "ghost",
      baseBranch: data.base.ref,
      headBranch: data.head.ref,
      headSha: data.head.sha,
      labels: (data.labels ?? []).map((l: any) => (typeof l === "string" ? l : l.name)),
      createdAt: data.created_at,
      updatedAt: data.updated_at,
      additions: data.additions,
      deletions: data.deletions,
      changedFiles: data.changed_files,
    };
  },
});

export const getPullRequestDiff = createTool({
  id: "get-pull-request-diff",
  description: "Fetch raw unified diff for a PR via Octokit. Prefer getPullRequestFiles for large PRs.",
  inputSchema: prIdentifierSchema,
  outputSchema: z.object({ diff: z.string() }),
  execute: async (inputData, context) => {
    const octokit = await resolveOctokit(context);
    const { data } = await octokit.request("GET /repos/{owner}/{repo}/pulls/{pull_number}", {
      owner: inputData.owner,
      repo: inputData.repo,
      pull_number: inputData.pullNumber,
      mediaType: { format: "diff" },
    });
    return { diff: data as unknown as string };
  },
});

const FILES_PER_PAGE = 30;

async function fetchAllPRFiles(octokit: any, owner: string, repo: string, pullNumber: number) {
  const all: any[] = [];
  let page = 1;
  while (true) {
    const { data } = await octokit.request("GET /repos/{owner}/{repo}/pulls/{pull_number}/files", {
      owner, repo, pull_number: pullNumber, per_page: 100, page,
    });
    if (data.length === 0) break;
    all.push(...data);
    if (data.length < 100) break;
    page++;
  }
  return all.map((f: any) => ({
    filename: f.filename as string,
    status: f.status as string,
    additions: f.additions as number,
    deletions: f.deletions as number,
    changes: f.changes as number,
    ...(f.patch !== undefined ? { patch: f.patch as string } : {}),
  }));
}

export const getPullRequestFiles = createTool({
  id: "get-pull-request-files",
  description:
    "List changed files with per-file patches via Octokit. Lockfiles/images filtered. Page 1-based, 30 reviewable files per page. Check hasMore.",
  inputSchema: prIdentifierSchema.extend({
    page: z.number().optional().default(1).describe("Page number (1-based)."),
  }),
  outputSchema: z.object({
    files: z.array(fileSchema),
    totalFiles: z.number(),
    reviewableCount: z.number(),
    hasMore: z.boolean(),
    page: z.number(),
  }),
  execute: async (inputData, context) => {
    const octokit = await resolveOctokit(context);
    const { owner, repo, pullNumber, page } = inputData;
    const allFiles = await fetchAllPRFiles(octokit, owner, repo, pullNumber);
    const reviewable = allFiles.filter((f) => !SKIP_PATTERNS.some((p) => p.test(f.filename)));
    const start = (page - 1) * FILES_PER_PAGE;
    return {
      files: reviewable.slice(start, start + FILES_PER_PAGE),
      totalFiles: allFiles.length,
      reviewableCount: reviewable.length,
      hasMore: start + FILES_PER_PAGE < reviewable.length,
      page,
    };
  },
});

export const getFileContent = createTool({
  id: "get-file-content",
  description:
    "Fetch full file content at a git ref via Octokit. Prefer headSha as ref. Returns null content if not found.",
  inputSchema: z.object({
    owner: z.string(),
    repo: z.string(),
    path: z.string().describe("File path in repo"),
    ref: z.string().describe("Commit SHA preferred; branch may fail if deleted."),
  }),
  outputSchema: z.object({
    content: z.string().nullable(),
    encoding: z.string(),
    size: z.number(),
  }),
  execute: async (inputData, context) => {
    const octokit = await resolveOctokit(context);
    try {
      const { data }: any = await octokit.request("GET /repos/{owner}/{repo}/contents/{path}", {
        owner: inputData.owner,
        repo: inputData.repo,
        path: inputData.path,
        ref: inputData.ref,
      });
      if (data.type !== "file" || !data.content) return { content: null, encoding: "utf-8", size: 0 };
      const decoded = Buffer.from(data.content, "base64").toString("utf-8");
      return { content: decoded, encoding: "utf-8", size: data.size as number };
    } catch (err: any) {
      if (err?.status === 404) return { content: null, encoding: "utf-8", size: 0 };
      throw err;
    }
  },
});
