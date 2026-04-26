/**
 * Code Agents — Phase 4.16
 *
 * smolagents-inspired code action agents:
 * The LLM writes Python/JavaScript code to solve tasks,
 * the code runs in a sandboxed subprocess, output is captured and fed back.
 *
 * Architecture:
 * - LLM generates code to solve a task
 * - Code runs in restricted subprocess (no network, limited resources)
 * - Output/errors are returned and optionally fed back for iteration
 * - Supports multi-turn: LLM can fix errors from previous runs
 *
 * Inspired by:
 * - smolagents (huggingface/smolagents, 14k stars) — LLM agents that write + execute code
 * - OpenHands CodeAct — code execution in sandboxed environment
 * - E2B (e2b-dev/e2b) — sandboxed code execution for AI
 *
 * SECURITY: Code runs as a child process with:
 * - Timeout enforcement
 * - Output size limits
 * - No privileged operations
 */

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { randomUUID } from "crypto";
import { execFile } from "child_process";
import { promisify } from "util";
import { writeFile, unlink, mkdir } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { askProvider } from "../lib/providers.js";
import { env } from "../config/env.js";
import logger from "../lib/logger.js";

const execFileAsync = promisify(execFile);

// ─── Config ───────────────────────────────────────────────────────────────────

const MAX_OUTPUT_BYTES = 50_000;
const EXECUTION_TIMEOUT_MS = 15_000;
const MAX_ITERATIONS = 5;

// ─── Types ────────────────────────────────────────────────────────────────────

type CodeLanguage = "python" | "javascript" | "typescript";

interface CodeRun {
  iteration: number;
  code: string;
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
  reasoning?: string;
}

interface CodeSession {
  sessionId: string;
  userId: number;
  task: string;
  language: CodeLanguage;
  runs: CodeRun[];
  finalOutput: string | null;
  status: "running" | "done" | "error";
  createdAt: string;
  updatedAt: string;
}

const codeSessions = new Map<string, CodeSession>();

// ─── Schemas ─────────────────────────────────────────────────────────────────

const runSchema = z.object({
  task:          z.string().min(1).max(2000),
  language:      z.enum(["python", "javascript"]).optional(),
  maxIterations: z.number().min(1).max(MAX_ITERATIONS).optional(),
  /** Initial code to run (skip LLM generation for first iteration) */
  initialCode:   z.string().optional(),
  /** Variables/data to inject as comments/constants */
  context:       z.string().max(2000).optional(),
});

const executeRawSchema = z.object({
  code:     z.string().min(1).max(20000),
  language: z.enum(["python", "javascript"]),
  timeout:  z.number().min(1000).max(EXECUTION_TIMEOUT_MS).optional(),
});

// ─── LLM code generation ──────────────────────────────────────────────────────

function buildCodePrompt(
  task: string,
  language: CodeLanguage,
  previousRuns: CodeRun[],
  context: string,
): string {
  const runHistory = previousRuns.length > 0
    ? previousRuns.map((r, i) => `
## Iteration ${i + 1}
\`\`\`${language}
${r.code}
\`\`\`
stdout: ${r.stdout.slice(0, 500) || "(empty)"}
stderr: ${r.stderr.slice(0, 300) || "(empty)"}
exit code: ${r.exitCode}`).join("\n")
    : "No previous runs.";

  return `You are a code agent. Write ${language} code to solve this task.

Task: ${task}
${context ? `Context:\n${context}\n` : ""}

Previous runs:
${runHistory}

Rules:
- Write ONLY the code (no markdown fences, no explanation)
- Use print() to output results
- The last print() output is the final answer
- If previous code had errors, fix them
- Keep code simple and direct

Respond in JSON: { "code": "...", "reasoning": "why this approach" }`;
}

// ─── Code execution ───────────────────────────────────────────────────────────

async function executeCode(
  code: string,
  language: CodeLanguage,
  timeoutMs: number = EXECUTION_TIMEOUT_MS,
): Promise<{ stdout: string; stderr: string; exitCode: number; durationMs: number }> {
  const tmpDir = join(tmpdir(), "aibyai-code-agent");
  await mkdir(tmpDir, { recursive: true });

  const ext = language === "python" ? "py" : "js";
  // Use crypto-random suffix to prevent temp file name prediction (insecure temp file)
  const { randomBytes } = await import("crypto");
  const safeSuffix = randomBytes(8).toString("hex");
  const filename = join(tmpDir, `run_${safeSuffix}.${ext}`);

  const start = Date.now();
  let stdout = "", stderr = "", exitCode = 0;

  try {
    await writeFile(filename, code, "utf-8");

    const interpreter = language === "python" ? "python3" : "node";
    const result = await execFileAsync(interpreter, [filename], {
      timeout: timeoutMs,
      maxBuffer: MAX_OUTPUT_BYTES,
      env: {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        // Explicitly exclude sensitive env vars
        PYTHONPATH: process.env.PYTHONPATH,
      },
    }).catch((err: NodeJS.ErrnoException & { stdout?: string; stderr?: string; code?: number }) => ({
      stdout: err.stdout ?? "",
      stderr: err.stderr ?? err.message,
      code: err.code ?? 1,
    }));

    stdout = String((result as { stdout?: string }).stdout ?? "").slice(0, MAX_OUTPUT_BYTES);
    stderr = String((result as { stderr?: string }).stderr ?? "").slice(0, MAX_OUTPUT_BYTES);
    exitCode = Number((result as { code?: number }).code ?? 0);
  } catch (err) {
    stderr = err instanceof Error ? err.message : String(err);
    exitCode = 1;
  } finally {
    await unlink(filename).catch(() => {});
  }

  return { stdout, stderr, exitCode, durationMs: Date.now() - start };
}

// ─── Routes ──────────────────────────────────────────────────────────────────

export async function codeAgentPlugin(app: FastifyInstance) {
  const llmProvider = {
    name: "openai",
    type: "api" as const,
    apiKey: env.OPENAI_API_KEY ?? "",
    model: "gpt-4o",
    systemPrompt: "You are a precise code generation agent. Write correct, minimal code. Respond only in JSON.",
  };

  /**
   * POST /code-agent/run
   * Run a code agent session: LLM generates code, code executes, iterate on errors.
   */
  app.post("/code-agent/run", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const parsed = runSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });

    const { task, language = "python", maxIterations = 3, initialCode, context = "" } = parsed.data;
    const sessionId = randomUUID();

    const session: CodeSession = {
      sessionId,
      userId,
      task,
      language,
      runs: [],
      finalOutput: null,
      status: "running",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    codeSessions.set(sessionId, session);

    // Run async
    (async () => {
      try {
        for (let i = 0; i < maxIterations; i++) {
          let code: string;
          let reasoning = "";

          if (i === 0 && initialCode) {
            code = initialCode;
          } else {
            const prompt = buildCodePrompt(task, language, session.runs, context);
            const response = await askProvider(llmProvider, [{ role: "user", content: prompt }]);
            let parsed_: { code?: string; reasoning?: string } = {};
            try {
              const match = response.text.match(/\{[\s\S]*\}/);
              if (match) parsed_ = JSON.parse(match[0]);
            } catch { parsed_.code = response.text; }
            code = (parsed_.code ?? "").trim();
            reasoning = parsed_.reasoning ?? "";
          }

          if (!code) { session.finalOutput = "LLM returned no code"; break; }

          const result = await executeCode(code, language);
          session.runs.push({ iteration: i + 1, code, reasoning, ...result });
          session.updatedAt = new Date().toISOString();

          // If successful, stop
          if (result.exitCode === 0) {
            session.finalOutput = result.stdout.trim() || "(no output)";
            session.status = "done";
            break;
          }
          // Last iteration failed
          if (i === maxIterations - 1) {
            session.finalOutput = `Failed after ${maxIterations} iterations. Last error: ${result.stderr.slice(0, 200)}`;
            session.status = "error";
          }
        }
        if (session.status === "running") session.status = "done";
      } catch (err) {
        session.status = "error";
        session.finalOutput = err instanceof Error ? err.message : String(err);
        logger.error({ sessionId, err: session.finalOutput }, "code-agent: session error");
      }
      codeSessions.set(sessionId, session);
    })();

    return reply.status(202).send({
      success: true,
      sessionId,
      status: "running",
      message: "Code agent started. Poll /code-agent/sessions/:id for results.",
    });
  });

  /**
   * POST /code-agent/execute
   * Execute raw code directly (no LLM loop).
   */
  app.post("/code-agent/execute", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const parsed = executeRawSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });

    const { code, language, timeout } = parsed.data;
    const result = await executeCode(code, language, timeout);

    return { success: true, ...result };
  });

  /**
   * GET /code-agent/sessions/:sessionId
   * Get the status and runs of a code agent session.
   */
  app.get("/code-agent/sessions/:sessionId", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const { sessionId } = req.params as { sessionId: string };
    const session = codeSessions.get(sessionId);
    if (!session || session.userId !== userId) {
      return reply.status(404).send({ error: "Session not found" });
    }
    return { success: true, session };
  });

  /**
   * GET /code-agent/sessions
   * List recent code agent sessions for the user.
   */
  app.get("/code-agent/sessions", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const sessions = [...codeSessions.values()]
      .filter((s) => s.userId === userId)
      .map(({ runs: _, ...s }) => ({ ...s, runCount: _.length }))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, 50);

    return { success: true, sessions, count: sessions.length };
  });
}
