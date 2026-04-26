/**
 * Reasoning Depth Control — Phase 7.16
 *
 * Exposes pluggable reasoning modes from src/lib/reasoningModes.ts.
 * Each mode uses a different deliberation strategy with different compute costs.
 *
 * Routes:
 *   GET  /reasoning/modes       — List modes with cost estimates
 *   POST /reasoning/run         — Run a question through a reasoning mode
 */

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  runSocraticPrelude,
  runRedBlueDebate,
  runHypothesisRefinement,
  runConfidenceCalibration,
  getLastReasoningUsage,
  type ReasoningMode,
} from "../lib/reasoningModes.js";
import { env } from "../config/env.js";

const provider = {
  name: "openai" as const,
  type: "api" as const,
  apiKey: env.OPENAI_API_KEY ?? env.ANTHROPIC_API_KEY ?? "",
  model: env.OPENAI_API_KEY ? "gpt-4o" : "claude-3-5-sonnet-20241022",
};

const MODE_DESCRIPTIONS: Record<ReasoningMode, { description: string; costMultiplier: number }> = {
  standard:    { description: "Single-pass response. Lowest cost.", costMultiplier: 1 },
  socratic:    { description: "Iterative question-and-answer prelude clarifying assumptions before answering.", costMultiplier: 2 },
  red_blue:    { description: "Red team / Blue team debate. Two opposing teams argue then reconcile.", costMultiplier: 3 },
  hypothesis:  { description: "Hypothesis generation and iterative refinement through evidence testing.", costMultiplier: 3 },
  confidence:  { description: "Calibrated confidence scoring per claim before synthesizing.", costMultiplier: 2 },
};

const runSchema = z.object({
  question: z.string().min(1).max(10_000),
  mode:     z.enum(["standard", "socratic", "red_blue", "hypothesis", "confidence"]),
});

export async function reasoningDepthPlugin(app: FastifyInstance) {

  /**
   * GET /reasoning/modes
   * Lists all available reasoning modes with cost estimates.
   */
  app.get("/reasoning/modes", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    return {
      success: true,
      modes: (Object.keys(MODE_DESCRIPTIONS) as ReasoningMode[]).map(mode => ({
        mode,
        ...MODE_DESCRIPTIONS[mode],
      })),
    };
  });

  /**
   * POST /reasoning/run
   * Run a question through the selected reasoning mode.
   * Returns the structured result and token usage.
   */
  app.post("/reasoning/run", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const parsed = runSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });

    const { question, mode } = parsed.data;
    let result: unknown;

    switch (mode) {
      case "standard":
        result = { answer: "Use the standard /api/ask endpoint for standard mode." };
        break;
      case "socratic":
        result = await runSocraticPrelude(question, provider);
        break;
      case "red_blue":
        result = await runRedBlueDebate(question, provider);
        break;
      case "hypothesis":
        result = await runHypothesisRefinement(question, provider);
        break;
      case "confidence":
        result = await runConfidenceCalibration(question, provider);
        break;
    }

    const usage = getLastReasoningUsage();

    return {
      success: true,
      mode,
      costMultiplier: MODE_DESCRIPTIONS[mode].costMultiplier,
      result,
      tokenUsage: usage,
    };
  });
}
