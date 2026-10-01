import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { getInstallationOctokit, getTestInstallationId } from "../lib/github-app";

/** Resolve installationId: worker/webhook requestContext first, env fallback for Studio manual runs. */
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

/** Wrap Octokit calls so failures carry the issue identity and HTTP status
 *  as a plain message — never a bare object the agent renders as [object Object]. */
async function gh(octokit: any, path: string, params: any, ref: string) {
  try {
    return await octokit.request(path, params);
  } catch (err: any) {
    const status = typeof err?.status === "number" ? ` (HTTP ${err.status})` : "";
    throw new Error(`GitHub ${path} for ${ref} failed${status}: ${err?.message ?? err}`);
  }
}

const issueIdentifierSchema = z.object({
  owner: z.string().describe("Repository owner (user or organization)"),
  repo: z.string().describe("Repository name"),
  issueNumber: z.number().describe("Issue number"),
});

const issueSchema = z.object({
  number: z.number(),
  title: z.string(),
  body: z.string().nullable(),
  state: z.string(),
  author: z.string(),
  labels: z.array(z.string()),
  createdAt: z.string(),
  updatedAt: z.string(),
  comments: z.number(),
});

export const getIssue = createTool({
  id: "get-issue",
  description:
    "Fetch a GitHub issue (title, body, author, labels, state) via Octokit installation auth. Use this — never triage from the webhook payload alone.",
  inputSchema: issueIdentifierSchema,
  outputSchema: issueSchema,
  execute: async (inputData, context) => {
    const octokit = await resolveOctokit(context);
    const ref = `${inputData.owner}/${inputData.repo}#${inputData.issueNumber}`;
    const { data } = await gh(octokit, "GET /repos/{owner}/{repo}/issues/{issue_number}", {
      owner: inputData.owner,
      repo: inputData.repo,
      issue_number: inputData.issueNumber,
    }, ref);
    return {
      number: data.number,
      title: data.title,
      body: (data.body as string | null) ?? null,
      state: data.state,
      author: (data.user as any)?.login ?? "ghost",
      labels: ((data.labels ?? []) as any[]).map((l) => (typeof l === "string" ? l : l.name)),
      createdAt: data.created_at,
      updatedAt: data.updated_at,
      comments: data.comments as number,
    };
  },
});

export const getRepository = createTool({
  id: "get-repository",
  description:
    "Fetch repo vision primitives: description, topics, default branch, open-issue count. This is the primary 'what are we building' source — always call it before judging alignment.",
  inputSchema: z.object({
    owner: z.string(),
    repo: z.string(),
  }),
  outputSchema: z.object({
    fullName: z.string(),
    description: z.string().nullable(),
    topics: z.array(z.string()),
    defaultBranch: z.string(),
    openIssues: z.number(),
  }),
  execute: async (inputData, context) => {
    const octokit = await resolveOctokit(context);
    const ref = `${inputData.owner}/${inputData.repo}`;
    const { data } = await gh(octokit, "GET /repos/{owner}/{repo}", {
      owner: inputData.owner,
      repo: inputData.repo,
    }, ref);
    return {
      fullName: data.full_name,
      description: (data.description as string | null) ?? null,
      topics: ((data as any).topics ?? []) as string[],
      defaultBranch: data.default_branch,
      openIssues: data.open_issues_count,
    };
  },
});

export const postIssueComment = createTool({
  id: "post-issue-comment",
  description:
    "Post the triage verdict as an issue comment via Octokit. The posted comment IS the deliverable — do not show the verdict in chat instead. Call exactly once per issue.",
  inputSchema: issueIdentifierSchema.extend({
    body: z.string().describe("Verdict markdown: classification, alignment assessment, and next step."),
  }),
  outputSchema: z.object({ commentId: z.number().nullable() }),
  execute: async (inputData, context) => {
    const octokit = await resolveOctokit(context);
    const ref = `${inputData.owner}/${inputData.repo}#${inputData.issueNumber}`;
    const { data } = await gh(octokit, "POST /repos/{owner}/{repo}/issues/{issue_number}/comments", {
      owner: inputData.owner,
      repo: inputData.repo,
      issue_number: inputData.issueNumber,
      body: inputData.body,
    }, ref);
    return { commentId: (data as any)?.id ?? null };
  },
});

const ALIGNMENT_LABELS = ["triaged-aligned", "triaged-misaligned", "triaged-unclear"] as const;
const TYPE_LABELS = ["bug", "enhancement", "question", "chore"] as const;

export const setIssueLabels = createTool({
  id: "set-issue-labels",
  description:
    "Label the issue with exactly one alignment label and one type label. The tool fetches current labels, drops stale triaged-*/type labels, and merges server-side — the caller never assembles label arrays, so label spam is impossible.",
  inputSchema: issueIdentifierSchema.extend({
    alignment: z.enum(ALIGNMENT_LABELS).describe("Exactly one alignment verdict."),
    typeLabel: z.enum(TYPE_LABELS).describe("Exactly one issue type."),
  }),
  outputSchema: z.object({ labels: z.array(z.string()) }),
  execute: async (inputData, context) => {
    const octokit = await resolveOctokit(context);
    const { owner, repo, issueNumber, alignment, typeLabel } = inputData;
    const ref = `${owner}/${repo}#${issueNumber}`;
    const { data: current } = await gh(octokit, "GET /repos/{owner}/{repo}/issues/{issue_number}/labels", {
      owner, repo, issue_number: issueNumber,
    }, ref);
    const kept = ((current ?? []) as any[])
      .map((l) => (typeof l === "string" ? l : l.name))
      .filter((name: string) => !ALIGNMENT_LABELS.includes(name as any) && !TYPE_LABELS.includes(name as any));
    const labels = [...kept, alignment, typeLabel];
    const { data } = await gh(octokit, "PUT /repos/{owner}/{repo}/issues/{issue_number}/labels", {
      owner, repo, issue_number: issueNumber, labels,
    }, ref);
    return { labels: ((data ?? []) as any[]).map((l) => (typeof l === "string" ? l : l.name)) };
  },
});
