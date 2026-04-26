/**
 * Response Verbosity Control — Phase 1.24
 *
 * Exposes the verbosity system prompt injection from src/lib/verbosity.ts.
 *
 * Routes:
 *   GET  /verbosity/levels      — List available verbosity levels and descriptions
 *   POST /verbosity/preview     — Preview what a prompt looks like at a given verbosity
 */

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { applyVerbosity, adjustMaxTokensForVerbosity, type VerbosityLevel } from "../lib/verbosity.js";

const VERBOSITY_DESCRIPTIONS: Record<VerbosityLevel, string> = {
  concise:    "2–3 sentences max. Direct, no preamble, no elaboration.",
  standard:   "Balanced response — default behavior, no override injected.",
  detailed:   "Structured with headers/lists. Full reasoning shown.",
  exhaustive: "Comprehensive. Covers all aspects, edge cases, alternatives. Cites sources.",
};

const previewSchema = z.object({
  systemPrompt: z.string().max(10_000).optional().default("You are a helpful assistant."),
  level:        z.enum(["concise", "standard", "detailed", "exhaustive"]),
  baseMaxTokens: z.number().int().min(100).max(32_000).optional().default(2000),
});

export async function verbosityPlugin(app: FastifyInstance) {

  /**
   * GET /verbosity/levels
   * Lists all verbosity levels with descriptions and token multipliers.
   */
  app.get("/verbosity/levels", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const levels: VerbosityLevel[] = ["concise", "standard", "detailed", "exhaustive"];

    return {
      success: true,
      levels: levels.map(level => ({
        level,
        description:     VERBOSITY_DESCRIPTIONS[level],
        adjustedTokens:  adjustMaxTokensForVerbosity(2000, level),
      })),
    };
  });

  /**
   * POST /verbosity/preview
   * Shows what the system prompt looks like after verbosity injection,
   * and the adjusted maxTokens for the requested level.
   */
  app.post("/verbosity/preview", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const parsed = previewSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });

    const { systemPrompt, level, baseMaxTokens } = parsed.data;
    const adapted = applyVerbosity(systemPrompt, level);
    const adjustedTokens = adjustMaxTokensForVerbosity(baseMaxTokens, level);

    return {
      success:          true,
      level,
      original:         systemPrompt,
      adapted,
      injected:         adapted !== systemPrompt,
      adjustedMaxTokens: adjustedTokens,
    };
  });
}
