/**
 * AUTOTUNE — POST /api/autotune/optimize
 *
 * Auto-optimize a system prompt by:
 * 1. Running the original prompt against test inputs
 * 2. Self-critiquing each output
 * 3. Proposing an improved prompt
 * 4. Validating the improved version on the same inputs
 * 5. Returning a scored diff: original vs optimized
 *
 * SSE events:
 *   step    — { phase, message }
 *   eval    — { inputIndex, originalScore, optimizedScore (null until phase 2) }
 *   result  — { originalPrompt, optimizedPrompt, diff, overallImprovement, metrics }
 *   error   — { message }
 */

import type { FastifyPluginAsync } from "fastify";
import { fastifyOptionalAuth } from "../middleware/fastifyAuth.js";
import { AppError } from "../middleware/errorHandler.js";
import { createProvider } from "../lib/providers/factory.js";
import logger from "../lib/logger.js";
import { env } from "../config/env.js";

const log = logger.child({ route: "autotune" });

// ── Types ─────────────────────────────────────────────────────────────────────

interface TestInput {
  user:      string;  // user message
  expected?: string;  // optional expected output for scoring
}

interface AutoTuneRequest {
  systemPrompt:  string;
  testInputs:    TestInput[];  // 1–10 test cases
  goal?:         string;       // what "good" looks like (e.g. "be concise, no hedging")
  iterations?:   number;       // 1 or 2 (default 1)
}

interface PromptScore {
  clarity:     number;  // 0–10
  specificity: number;  // 0–10
  consistency: number;  // 0–10
  overall:     number;  // 0–10
}

// ── Critic system prompt ──────────────────────────────────────────────────────

const CRITIC_PROMPT = `You are an expert prompt engineer and AI output critic.
You analyze AI outputs and the system prompts that produced them.
Be precise, specific, and constructive. Avoid vague feedback.`;

const OPTIMIZER_PROMPT = `You are an expert prompt engineer.
You take a system prompt, its outputs on test cases, critique feedback, and a goal —
then you write an improved system prompt.

Rules:
- Keep improvements surgical — don't change what works
- Be specific about behaviors you're adding/removing
- No meta-commentary — just return the improved prompt text directly
- Do not wrap in quotes or add preamble`;

// ── Scoring ───────────────────────────────────────────────────────────────────

function parseCritiqueScore(text: string): number {
  // Extract numeric score from critique (0–10)
  const m = text.match(/(?:score|rating|quality)[^\d]*(\d+(?:\.\d+)?)\s*\/\s*10/i)
            ?? text.match(/\b(\d+(?:\.\d+)?)\s*\/\s*10\b/)
            ?? text.match(/\b([0-9](?:\.[0-9])?)\b/);
  if (!m) return 5;
  return Math.min(10, Math.max(0, parseFloat(m[1])));
}

// ── Provider ───────────────────────────────────────────────────────────────────

function getProvider() {
  if (env.ANTHROPIC_API_KEY) return { name: "anthropic", model: "claude-3-5-sonnet-20241022", apiKey: env.ANTHROPIC_API_KEY };
  if (env.OPENAI_API_KEY)    return { name: "openai",    model: "gpt-4o",                     apiKey: env.OPENAI_API_KEY    };
  if (env.GROQ_API_KEY)      return {
    name: "groq", model: "llama-3.3-70b-versatile", apiKey: env.GROQ_API_KEY,
    baseUrl: "https://api.groq.com/openai/v1",
  };
  return null;
}

// ── Plugin ────────────────────────────────────────────────────────────────────

const autotunePlugin: FastifyPluginAsync = async (fastify) => {

  fastify.get("/", async () => ({
    description: "AUTOTUNE — iterative system prompt optimizer",
    maxTestInputs: 10,
    maxIterations: 2,
  }));

  fastify.post<{ Body: AutoTuneRequest }>(
    "/optimize",
    { preHandler: fastifyOptionalAuth },
    async (request, reply) => {
      const { systemPrompt, testInputs, goal, iterations = 1 } = request.body ?? {};

      if (!systemPrompt?.trim()) throw new AppError(400, "systemPrompt is required");
      if (!testInputs?.length)   throw new AppError(400, "testInputs[] is required (min 1)");
      if (testInputs.length > 10) throw new AppError(400, "Max 10 testInputs");

      const providerCfg = getProvider();
      if (!providerCfg) throw new AppError(503, "No AI provider configured (set ANTHROPIC_API_KEY or OPENAI_API_KEY)");

      const safeIterations = Math.max(1, Math.min(2, iterations));

      // ── SSE ────────────────────────────────────────────────────────────────

      reply.raw.writeHead(200, {
        "Content-Type":               "text/event-stream",
        "Cache-Control":              "no-cache",
        "Connection":                 "keep-alive",
        "X-Accel-Buffering":          "no",
        "Access-Control-Allow-Origin": "*",
      });

      const emit = (type: string, data: Record<string, unknown>) => {
        if (!reply.raw.writableEnded) {
          reply.raw.write(`data: ${JSON.stringify({ type, ...data })}\n\n`);
        }
      };

      const controller = new AbortController();
      request.raw.on("close", () => controller.abort());
      request.raw.on("error", () => controller.abort());

      try {
        const prov = createProvider(providerCfg);

        async function runPrompt(sysPrompt: string, input: TestInput): Promise<string> {
          const resp = await prov.chat(
            [
              { role: "system", content: sysPrompt },
              { role: "user",   content: input.user },
            ],
            { signal: controller.signal }
          );
          return resp.content ?? "";
        }

        async function critiqueOutput(
          sysPrompt: string,
          userInput: string,
          output: string,
          expected?: string,
          goalHint?: string,
        ): Promise<{ critique: string; score: number }> {
          const expectedNote = expected ? `\nExpected output roughly: "${expected}"` : "";
          const goalNote     = goalHint ? `\nOptimization goal: ${goalHint}` : "";

          const resp = await prov.chat(
            [
              { role: "system", content: CRITIC_PROMPT },
              {
                role: "user",
                content:
                  `System prompt:\n"""\n${sysPrompt}\n"""\n\n` +
                  `User input: "${userInput}"\n\n` +
                  `AI output:\n"""\n${output}\n"""\n` +
                  expectedNote + goalNote +
                  `\n\nCritique the output quality and suggest what the system prompt should do better. ` +
                  `End with a score out of 10 (format: "Score: X/10").`,
              },
            ],
            { signal: controller.signal }
          );
          const text  = resp.content ?? "";
          const score = parseCritiqueScore(text);
          return { critique: text, score };
        }

        async function optimizePrompt(
          originalPrompt: string,
          testCases: Array<{ input: TestInput; output: string; critique: string }>,
          goalHint?: string,
        ): Promise<string> {
          const cases = testCases
            .map((c, i) =>
              `Test ${i + 1}:\n  User: "${c.input.user}"\n  Output: "${c.output.slice(0, 300)}${c.output.length > 300 ? "…" : ""}"\n  Critique: ${c.critique.slice(0, 400)}`
            )
            .join("\n\n");

          const goalSection = goalHint ? `\nOptimization goal: ${goalHint}\n` : "";

          const resp = await prov.chat(
            [
              { role: "system", content: OPTIMIZER_PROMPT },
              {
                role: "user",
                content:
                  `Original system prompt:\n"""\n${originalPrompt}\n"""\n` +
                  goalSection +
                  `\nTest case performance:\n${cases}\n\n` +
                  `Write an improved system prompt that addresses the critiques above.`,
              },
            ],
            { signal: controller.signal }
          );
          return (resp.content ?? "").trim();
        }

        // ── Phase 1: evaluate original prompt ─────────────────────────────────

        emit("step", { phase: 1, message: `Running original prompt on ${testInputs.length} test input${testInputs.length !== 1 ? "s" : ""}…` });

        const phase1Results: Array<{
          input:    TestInput;
          output:   string;
          critique: string;
          score:    number;
        }> = [];

        for (let i = 0; i < testInputs.length; i++) {
          const input  = testInputs[i];
          const output = await runPrompt(systemPrompt, input);
          const { critique, score } = await critiqueOutput(systemPrompt, input.user, output, input.expected, goal);

          phase1Results.push({ input, output, critique, score });
          emit("eval", { inputIndex: i, phase: 1, score, output: output.slice(0, 200) });
        }

        const originalAvg = phase1Results.reduce((s, r) => s + r.score, 0) / phase1Results.length;
        emit("step", { phase: 1, message: `Original prompt avg score: ${originalAvg.toFixed(1)}/10` });

        // ── Phase 2: generate improved prompt ─────────────────────────────────

        emit("step", { phase: 2, message: "Generating optimized prompt…" });
        let currentPrompt = systemPrompt;
        let currentResults = phase1Results;

        for (let iter = 0; iter < safeIterations; iter++) {
          const improved = await optimizePrompt(currentPrompt, currentResults, goal);

          emit("step", { phase: 2, message: `Iteration ${iter + 1}: validating improved prompt…` });

          // Re-evaluate on same test inputs with new prompt
          const iterResults: typeof phase1Results = [];
          for (let i = 0; i < testInputs.length; i++) {
            const input  = testInputs[i];
            const output = await runPrompt(improved, input);
            const { critique, score } = await critiqueOutput(improved, input.user, output, input.expected, goal);

            iterResults.push({ input, output, critique, score });
            emit("eval", {
              inputIndex: i,
              phase:      2,
              iteration:  iter + 1,
              score,
              originalScore: phase1Results[i].score,
              output:    output.slice(0, 200),
            });
          }

          currentPrompt  = improved;
          currentResults = iterResults;
        }

        const optimizedAvg = currentResults.reduce((s, r) => s + r.score, 0) / currentResults.length;
        const improvement  = optimizedAvg - originalAvg;

        // Build simple diff: lines added/removed
        const origLines  = systemPrompt.split("\n");
        const optLines   = currentPrompt.split("\n");
        const added      = optLines.filter((l) => !origLines.includes(l)).length;
        const removed    = origLines.filter((l) => !optLines.includes(l)).length;

        emit("result", {
          originalPrompt:   systemPrompt,
          optimizedPrompt:  currentPrompt,
          originalScore:    parseFloat(originalAvg.toFixed(2)),
          optimizedScore:   parseFloat(optimizedAvg.toFixed(2)),
          overallImprovement: parseFloat(improvement.toFixed(2)),
          diff: { linesAdded: added, linesRemoved: removed },
          testResults: currentResults.map((r, i) => ({
            input:         r.input.user,
            originalScore: phase1Results[i].score,
            optimizedScore: r.score,
            delta:         r.score - phase1Results[i].score,
          })),
        });

      } catch (err) {
        if ((err as Error).name === "AbortError") return;
        const msg = err instanceof Error ? err.message : "AutoTune failed";
        log.error({ err }, msg);
        emit("error", { message: msg });
      } finally {
        if (!reply.raw.writableEnded) reply.raw.end();
      }
    }
  );
};

export default autotunePlugin;
