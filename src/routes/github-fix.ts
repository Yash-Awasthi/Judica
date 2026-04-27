/**
 * GitHub Issue → Automated PR — Phase 4.17
 *
 * SWE-agent inspired: given a GitHub issue, the agent:
 * 1. Fetches the issue description
 * 2. Retrieves relevant code context from the repo
 * 3. Plans a fix (LLM)
 * 4. Generates a code patch
 * 5. Creates a branch and pull request via GitHub API
 *
 * Inspired by:
 * - OpenHands / All-Hands-AI (OpenHands, 44k stars) — automated software engineering
 * - SWE-agent (princeton-nlp/SWE-agent) — LLM agent for GitHub issues
 * - Aider — LLM-based code editing with git integration
 *
 * Required env vars:
 * - GITHUB_TOKEN — personal access token with repo scope
 */

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { randomUUID } from "crypto";
import { askProvider } from "../lib/providers.js";
import { env } from "../config/env.js";
import logger from "../lib/logger.js";

const GITHUB_TOKEN = process.env.GITHUB_TOKEN ?? "";
const GITHUB_API = "https://api.github.com";

// ─── GitHub API helpers ───────────────────────────────────────────────────────

async function ghFetch(path: string, opts: RequestInit = {}): Promise<Response> {
  return fetch(`${GITHUB_API}${path}`, {
    headers: {
      Authorization: `token ${GITHUB_TOKEN}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
      ...(opts.headers as Record<string, string> ?? {}),
    },
    ...opts,
  });
}

async function ghJson<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const res = await ghFetch(path, opts);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GitHub API ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json() as Promise<T>;
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface FixSession {
  sessionId: string;
  userId: number;
  owner: string;
  repo: string;
  issueNumber: number;
  issueTitle: string;
  issueBody: string;
  plan: string | null;
  patch: string | null;
  branchName: string | null;
  prUrl: string | null;
  prNumber: number | null;
  status: "analyzing" | "planning" | "patching" | "creating_pr" | "done" | "error";
  error: string | null;
  logs: string[];
  createdAt: string;
  updatedAt: string;
}

const fixSessions = new Map<string, FixSession>();

// ─── Schemas ─────────────────────────────────────────────────────────────────

const startFixSchema = z.object({
  owner:       z.string().min(1).max(100),
  repo:        z.string().min(1).max(100),
  issueNumber: z.number().int().positive(),
  /** Target branch to branch from (default: main) */
  baseBranch:  z.string().optional(),
  /** Additional context files to include in the analysis */
  contextPaths: z.array(z.string()).max(5).optional(),
});

// ─── LLM helpers ─────────────────────────────────────────────────────────────

const llmProvider = {
  name: "openai",
  type: "api" as const,
  apiKey: env.OPENAI_API_KEY ?? "",
  model: "gpt-4o",
  systemPrompt: "You are an expert software engineer. Analyze issues and generate precise code fixes. Respond only in JSON.",
};

function buildPlanPrompt(issue: { title: string; body: string }, codeContext: string): string {
  return `Analyze this GitHub issue and plan a fix.

Issue Title: ${issue.title}
Issue Body:
${issue.body.slice(0, 3000)}

Relevant Code Context:
${codeContext.slice(0, 5000)}

Plan the minimal fix required. Respond in JSON:
{
  "rootCause": "...",
  "fix_plan": "step-by-step plan",
  "files_to_modify": ["path/to/file.ts"],
  "new_files": ["path/to/new.ts"],
  "complexity": "trivial|simple|moderate|complex"
}`;
}

function buildPatchPrompt(plan: string, codeContext: string, issue: { title: string }): string {
  return `Generate a unified diff patch to fix this issue.

Issue: ${issue.title}
Fix Plan: ${plan}

Current Code:
${codeContext.slice(0, 5000)}

Generate a minimal unified diff patch. Format:
--- a/path/to/file
+++ b/path/to/file
@@ -N,M +N,M @@
 context line
-removed line
+added line

Respond in JSON:
{
  "patch": "--- a/...",
  "commit_message": "fix: ...",
  "description": "what was changed and why"
}`;
}

// ─── GitHub operations ────────────────────────────────────────────────────────

async function getFileContent(owner: string, repo: string, path: string): Promise<string> {
  try {
    const data = await ghJson<{ content?: string }>(`/repos/${owner}/${repo}/contents/${path}`);
    if (data.content) {
      return Buffer.from(data.content, "base64").toString("utf-8");
    }
  } catch { /* file not found */ }
  return "";
}

async function createBranchAndPR(
  owner: string,
  repo: string,
  baseBranch: string,
  newBranch: string,
  patch: string,
  commitMessage: string,
  prTitle: string,
  prBody: string,
  session: FixSession,
): Promise<{ prUrl: string; prNumber: number }> {
  // 1. Get base branch SHA
  const branchData = await ghJson<{ commit: { sha: string } }>(`/repos/${owner}/${repo}/git/refs/heads/${baseBranch}`);
  const baseSha = branchData.commit.sha;
  session.logs.push(`Base branch SHA: ${baseSha.slice(0, 8)}`);

  // 2. Create new branch
  await ghJson(`/repos/${owner}/${repo}/git/refs`, {
    method: "POST",
    body: JSON.stringify({ ref: `refs/heads/${newBranch}`, sha: baseSha }),
  });
  session.logs.push(`Created branch: ${newBranch}`);

  // 3. Parse patch to extract file changes and apply them
  // For each modified file, get current content, apply patch, update via API
  const patchLines = patch.split("\n");
  let currentFile = "";
  const filePatches: Map<string, string[]> = new Map();

  for (const line of patchLines) {
    if (line.startsWith("--- a/")) {
      currentFile = line.replace("--- a/", "");
    } else if (line.startsWith("+++ b/")) {
      currentFile = line.replace("+++ b/", "");
      if (!filePatches.has(currentFile)) filePatches.set(currentFile, []);
    } else if (currentFile && (line.startsWith("+") || line.startsWith("-") || line.startsWith(" "))) {
      filePatches.get(currentFile)?.push(line);
    }
  }

  // Apply each file change
  for (const [filePath, patchChunk] of filePatches) {
    try {
      const originalContent = await getFileContent(owner, repo, filePath);
      const newLines: string[] = [];
      for (const line of patchChunk) {
        if (line.startsWith("+")) newLines.push(line.slice(1));
        else if (line.startsWith(" ")) newLines.push(line.slice(1));
        // skip removed lines
      }
      const newContent = newLines.join("\n");
      const encoded = Buffer.from(newContent).toString("base64");

      // Get current file SHA for update
      let fileSha: string | undefined;
      try {
        const existing = await ghJson<{ sha?: string }>(`/repos/${owner}/${repo}/contents/${filePath}?ref=${newBranch}`);
        fileSha = existing.sha;
      } catch { /* new file */ }

      await ghJson(`/repos/${owner}/${repo}/contents/${filePath}`, {
        method: "PUT",
        body: JSON.stringify({
          message: commitMessage,
          content: encoded,
          branch: newBranch,
          ...(fileSha ? { sha: fileSha } : {}),
        }),
      });
      session.logs.push(`Updated file: ${filePath}`);
    } catch (err) {
      session.logs.push(`Warning: could not update ${filePath}: ${err instanceof Error ? err.message : err}`);
    }
  }

  // 4. Create PR
  const pr = await ghJson<{ html_url: string; number: number }>(`/repos/${owner}/${repo}/pulls`, {
    method: "POST",
    body: JSON.stringify({
      title: prTitle,
      body: prBody,
      head: newBranch,
      base: baseBranch,
    }),
  });

  session.logs.push(`PR created: ${pr.html_url}`);
  return { prUrl: pr.html_url, prNumber: pr.number };
}

// ─── Routes ──────────────────────────────────────────────────────────────────

export async function githubFixPlugin(app: FastifyInstance) {

  /**
   * POST /github-fix/start
   * Start an automated fix for a GitHub issue.
   */
  app.post("/github-fix/start", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    if (!GITHUB_TOKEN) {
      return reply.status(503).send({ error: "GITHUB_TOKEN not configured" });
    }

    const parsed = startFixSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });

    const { owner, repo, issueNumber, baseBranch = "main", contextPaths = [] } = parsed.data;
    const sessionId = randomUUID();

    // Fetch issue
    let issue: { title: string; body: string; html_url: string };
    try {
      issue = await ghJson(`/repos/${owner}/${repo}/issues/${issueNumber}`);
    } catch (err) {
      return reply.status(400).send({ error: `Failed to fetch issue: ${err instanceof Error ? err.message : err}` });
    }

    const session: FixSession = {
      sessionId,
      userId,
      owner,
      repo,
      issueNumber,
      issueTitle: issue.title,
      issueBody: issue.body ?? "",
      plan: null,
      patch: null,
      branchName: null,
      prUrl: null,
      prNumber: null,
      status: "analyzing",
      error: null,
      logs: [`Fetched issue #${issueNumber}: ${issue.title}`],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    fixSessions.set(sessionId, session);

    // Run async
    (async () => {
      try {
        // 1. Gather context
        let codeContext = "";
        for (const path of contextPaths) {
          const content = await getFileContent(owner, repo, path);
          if (content) codeContext += `\n// ${path}\n${content.slice(0, 2000)}\n`;
        }
        session.logs.push(`Gathered context from ${contextPaths.length} files`);

        // 2. Plan
        session.status = "planning";
        session.updatedAt = new Date().toISOString();
        const planRes = await askProvider(llmProvider, [{ role: "user", content: buildPlanPrompt(issue, codeContext) }]);
        let planData: { fix_plan?: string; files_to_modify?: string[]; commit_message?: string } = {};
        try {
          const match = planRes.text.match(/\{[\s\S]*\}/);
          if (match) planData = JSON.parse(match[0]);
        } catch { planData.fix_plan = planRes.text; }
        session.plan = planData.fix_plan ?? planRes.text;
        session.logs.push(`Plan created: ${session.plan.slice(0, 100)}`);

        // Load additional context from planned files
        for (const filePath of (planData.files_to_modify ?? []).slice(0, 3)) {
          const content = await getFileContent(owner, repo, filePath);
          if (content) codeContext += `\n// ${filePath}\n${content.slice(0, 2000)}\n`;
        }

        // 3. Generate patch
        session.status = "patching";
        session.updatedAt = new Date().toISOString();
        const patchRes = await askProvider(llmProvider, [{ role: "user", content: buildPatchPrompt(session.plan, codeContext, issue) }]);
        let patchData: { patch?: string; commit_message?: string; description?: string } = {};
        try {
          const match = patchRes.text.match(/\{[\s\S]*\}/);
          if (match) patchData = JSON.parse(match[0]);
        } catch { patchData.patch = patchRes.text; }
        session.patch = patchData.patch ?? "";
        session.logs.push(`Patch generated (${session.patch.length} chars)`);

        // 4. Create branch + PR
        session.status = "creating_pr";
        session.updatedAt = new Date().toISOString();
        const branchName = `fix/issue-${issueNumber}-${sessionId.slice(0, 8)}`;
        session.branchName = branchName;

        const { prUrl, prNumber } = await createBranchAndPR(
          owner, repo, baseBranch, branchName,
          session.patch,
          patchData.commit_message ?? `fix: resolve issue #${issueNumber}`,
          `fix: ${issue.title} (#${issueNumber})`,
          `Automated fix for #${issueNumber}\n\n${patchData.description ?? session.plan}\n\n_Generated by judica SWE agent_`,
          session,
        );

        session.prUrl = prUrl;
        session.prNumber = prNumber;
        session.status = "done";
      } catch (err) {
        session.status = "error";
        session.error = err instanceof Error ? err.message : String(err);
        logger.error({ sessionId, err: session.error }, "github-fix: session error");
        session.logs.push(`Error: ${session.error}`);
      }
      session.updatedAt = new Date().toISOString();
      fixSessions.set(sessionId, session);
    })();

    return reply.status(202).send({
      success: true,
      sessionId,
      issueTitle: issue.title,
      status: "analyzing",
    });
  });

  /**
   * GET /github-fix/sessions/:sessionId
   * Poll the status of a fix session.
   */
  app.get("/github-fix/sessions/:sessionId", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const { sessionId } = req.params as { sessionId: string };
    const session = fixSessions.get(sessionId);
    if (!session || session.userId !== userId) {
      return reply.status(404).send({ error: "Session not found" });
    }
    return { success: true, session };
  });

  /**
   * GET /github-fix/sessions
   * List all fix sessions for the user.
   */
  app.get("/github-fix/sessions", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const sessions = [...fixSessions.values()]
      .filter((s) => s.userId === userId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

    return { success: true, sessions, count: sessions.length };
  });

  /**
   * GET /github-fix/status
   * Check if GITHUB_TOKEN is configured.
   */
  app.get("/github-fix/status", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    return {
      success: true,
      configured: Boolean(GITHUB_TOKEN),
      token: GITHUB_TOKEN ? `ghp_${GITHUB_TOKEN.slice(4, 12)}***` : null,
    };
  });
}
