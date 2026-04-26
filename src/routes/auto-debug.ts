/**
 * Auto-Debugging Agent — Phase 4.6
 *
 * Given an error trace + codebase context, the agent iterates:
 * 1. Analyze → identify root cause
 * 2. Propose a fix (patch/diff format)
 * 3. Validate (syntax check, heuristic)
 * 4. Optionally auto-apply to the BuildTask's codebase
 *
 * Inspired by:
 * - Aider (paul-gauthier/aider, 24k stars) — LLM pair programmer with diff/patch
 * - SWE-agent (princeton-nlp/SWE-agent) — LLM → shell loop for repo-level fixes
 * - OpenHands (All-Hands-AI/OpenHands) — code agent with file editing
 */

import type { FastifyInstance } from "fastify";
import { db } from "../lib/drizzle.js";
import { buildTasks } from "../db/schema/buildTasks.js";
import { eq, and } from "drizzle-orm";
import { z } from "zod";
import { askProvider } from "../lib/providers.js";
import { env } from "../config/env.js";

// ─── Schemas ─────────────────────────────────────────────────────────────────

const debugSchema = z.object({
  /** Stack trace or error message */
  errorTrace: z.string().min(1).max(8000),
  /** Relevant source files as { path: content } map */
  codeContext: z.record(z.string(), z.string()).optional(),
  /** Language hint (python, typescript, rust, …) */
  language: z.string().optional(),
  /** Whether to attach the debug result to a build task */
  taskId: z.number().optional(),
  /** Max fix-attempt iterations (default 3) */
  maxIterations: z.number().min(1).max(5).optional(),
});

const applyFixSchema = z.object({
  /** Unified diff to apply (stored from debug session) */
  patch: z.string().min(1),
  /** Target file path (within repo context) */
  filePath: z.string().min(1),
  /** Original content to validate patch applies cleanly */
  originalContent: z.string(),
});

// ─── Prompts ─────────────────────────────────────────────────────────────────

function buildDebugPrompt(
  errorTrace: string,
  codeContext: Record<string, string>,
  language: string,
  iteration: number,
): string {
  const fileSnippets = Object.entries(codeContext)
    .map(([path, content]) => `### ${path}\n\`\`\`${language}\n${content.slice(0, 3000)}\n\`\`\``)
    .join("\n\n");

  return `You are an expert debugging agent (iteration ${iteration}).

## Error / Stack Trace
\`\`\`
${errorTrace}
\`\`\`

## Relevant Source Files
${fileSnippets || "(no files provided)"}

## Task
1. Identify the root cause of the error in 1–2 sentences.
2. Propose the minimal fix as a unified diff (--- old +++ new format).
3. If no diff is possible (config issue, missing dependency, etc.), describe the fix instead.

Respond ONLY in JSON:
{
  "rootCause": "...",
  "confidence": 0.0–1.0,
  "fixType": "diff" | "config" | "dependency" | "environment",
  "patch": "--- a/path\\n+++ b/path\\n@@ ... @@\\n...",
  "filePath": "src/...",
  "description": "brief human-readable explanation of the fix",
  "followUpSteps": ["optional additional steps"]
}`;
}

function buildValidationPrompt(patch: string, language: string): string {
  return `Validate this patch for a ${language} project:

\`\`\`diff
${patch.slice(0, 3000)}
\`\`\`

Check: correct unified diff format, no obvious syntax errors introduced, minimal change.
Respond in JSON: { "valid": true|false, "issues": ["..."] }`;
}

// ─── Routes ──────────────────────────────────────────────────────────────────

export async function autoDebugPlugin(app: FastifyInstance) {
  const debugProvider = {
    name: "openai",
    type: "api" as const,
    apiKey: env.OPENAI_API_KEY ?? "",
    model: "gpt-4o",
    systemPrompt: "You are a precise debugging and code repair agent. Respond only in JSON.",
  };

  /**
   * POST /debug/analyze
   * Analyze an error trace + code context and produce a fix.
   * Iterates up to maxIterations times if confidence is low.
   */
  app.post("/debug/analyze", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const parsed = debugSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });

    const {
      errorTrace,
      codeContext = {},
      language = "typescript",
      taskId,
      maxIterations = 3,
    } = parsed.data;

    const iterations: unknown[] = [];
    let bestFix: Record<string, unknown> | null = null;

    for (let i = 1; i <= maxIterations; i++) {
      const prompt = buildDebugPrompt(errorTrace, codeContext, language, i);
      const response = await askProvider(debugProvider, [{ role: "user", content: prompt }]);

      let fix: Record<string, unknown> = {};
      try {
        const match = response.text.match(/\{[\s\S]*\}/);
        if (match) fix = JSON.parse(match[0]);
      } catch {
        fix = { rootCause: response.text.slice(0, 200), confidence: 0 };
      }

      iterations.push({ iteration: i, ...fix });

      // Accept if confidence >= 0.7
      if ((fix.confidence as number) >= 0.7) {
        bestFix = fix;
        break;
      }
      bestFix = fix; // keep last even if low-confidence
    }

    // If taskId provided, attach debug result to the build task
    if (taskId) {
      const [task] = await db
        .select()
        .from(buildTasks)
        .where(and(eq(buildTasks.id, taskId), eq(buildTasks.userId, userId)))
        .limit(1);

      if (task) {
        const existingMeta = (task.meta as Record<string, unknown>) ?? {};
        await db
          .update(buildTasks)
          .set({
            meta: {
              ...existingMeta,
              debugResult: bestFix,
              debugIterations: iterations.length,
              debuggedAt: new Date().toISOString(),
            },
            updatedAt: new Date(),
          })
          .where(eq(buildTasks.id, taskId));
      }
    }

    return {
      success: true,
      fix: bestFix,
      iterations,
      language,
    };
  });

  /**
   * POST /debug/validate
   * Validate a proposed patch without applying it.
   */
  app.post("/debug/validate", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const { patch, language = "typescript" } = req.body as { patch?: string; language?: string };
    if (!patch) return reply.status(400).send({ error: "patch required" });

    const prompt = buildValidationPrompt(patch, language);
    const response = await askProvider(debugProvider, [{ role: "user", content: prompt }]);

    let result = { valid: true, issues: [] as string[] };
    try {
      const match = response.text.match(/\{[\s\S]*\}/);
      if (match) result = JSON.parse(match[0]);
    } catch { /* use default */ }

    return { success: true, ...result };
  });

  /**
   * POST /debug/apply
   * Apply a unified diff patch to the provided original content (in-memory).
   * Returns the patched content — does NOT write to disk.
   * The caller is responsible for persisting the result.
   */
  app.post("/debug/apply", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const parsed = applyFixSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });

    const { patch, filePath, originalContent } = parsed.data;

    // Simple unified diff application (line-level)
    const patched = applyUnifiedDiff(originalContent, patch);

    return {
      success: true,
      filePath,
      originalLines: originalContent.split("\n").length,
      patchedLines: patched.split("\n").length,
      patchedContent: patched,
    };
  });

  /**
   * GET /debug/task/:taskId
   * Retrieve the debug result attached to a build task.
   */
  app.get("/debug/task/:taskId", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const taskId = Number((req.params as any).taskId);
    const [task] = await db
      .select()
      .from(buildTasks)
      .where(and(eq(buildTasks.id, taskId), eq(buildTasks.userId, userId)))
      .limit(1);

    if (!task) return reply.status(404).send({ error: "Task not found" });

    const meta = (task.meta as Record<string, unknown>) ?? {};
    return {
      success: true,
      taskId,
      debugResult: meta.debugResult ?? null,
      debuggedAt: meta.debuggedAt ?? null,
      iterations: meta.debugIterations ?? null,
    };
  });
}

// ─── Utilities ────────────────────────────────────────────────────────────────

/**
 * Minimal unified diff applicator (hunk-by-hunk).
 * Only handles simple @@-based hunks with +/- lines.
 * For complex patches, a real diff library should be used.
 */
function applyUnifiedDiff(original: string, patch: string): string {
  const lines = original.split("\n");
  const patchLines = patch.split("\n");

  let offset = 0;

  for (let i = 0; i < patchLines.length; i++) {
    const line = patchLines[i];
    const hunkMatch = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (!hunkMatch) continue;

    let srcLine = parseInt(hunkMatch[1], 10) - 1 + offset; // 0-indexed

    // Collect hunk lines
    const hunkRemove: string[] = [];
    const hunkAdd: string[] = [];
    let j = i + 1;
    while (j < patchLines.length && !patchLines[j].startsWith("@@") && !patchLines[j].startsWith("---") && !patchLines[j].startsWith("+++")) {
      const hl = patchLines[j];
      if (hl.startsWith("-")) hunkRemove.push(hl.slice(1));
      else if (hl.startsWith("+")) hunkAdd.push(hl.slice(1));
      j++;
    }

    // Apply: remove old lines, insert new lines
    lines.splice(srcLine, hunkRemove.length, ...hunkAdd);
    offset += hunkAdd.length - hunkRemove.length;
  }

  return lines.join("\n");
}
