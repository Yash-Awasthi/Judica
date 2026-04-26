/**
 * Token Conservation Mode — Phase 1.5
 *
 * Exposes the LLMLingua / heuristic compression pipeline from
 * src/lib/tokenConservation.ts as API endpoints.
 *
 * Routes:
 *   POST /token-conservation/compress  — Compress a prompt before sending to LLM
 *   GET  /token-conservation/status    — Check whether LLMLingua server is available
 */

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { compressPrompt, heuristicCompress } from "../lib/tokenConservation.js";

const compressSchema = z.object({
  /** The full prompt / context to compress */
  text: z.string().min(1).max(200_000),
  /** 0–1: fraction to keep (0.5 = keep ~50% of tokens). Default: 0.5 */
  ratio: z.number().min(0.1).max(0.95).optional().default(0.5),
  /** Use heuristic-only mode even if LLMLingua is available. Default: false */
  heuristicOnly: z.boolean().optional().default(false),
});

export async function tokenConservationPlugin(app: FastifyInstance) {

  /**
   * POST /token-conservation/compress
   * Compress a prompt. Returns the compressed text and savings stats.
   */
  app.post("/token-conservation/compress", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const parsed = compressSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });

    const { text, ratio, heuristicOnly } = parsed.data;

    const result = heuristicOnly
      ? {
          compressed: heuristicCompress(text),
          originTokens: Math.ceil(text.length / 4),
          compressedTokens: Math.ceil(heuristicCompress(text).length / 4),
          ratio: "heuristic",
          backend: "heuristic" as const,
        }
      : await compressPrompt(text, ratio);

    const savedPct = result.originTokens > 0
      ? Math.round((1 - result.compressedTokens / result.originTokens) * 100)
      : 0;

    return {
      success:        true,
      compressed:     result.compressed,
      originTokens:   result.originTokens,
      compressedTokens: result.compressedTokens,
      savedPercent:   savedPct,
      backend:        result.backend,
    };
  });

  /**
   * GET /token-conservation/status
   * Returns whether the LLMLingua server is reachable,
   * and the heuristic fallback availability.
   */
  app.get("/token-conservation/status", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const llmLinguaUrl = process.env.LLMLINGUA_URL ?? null;
    let llmLinguaAvailable = false;

    if (llmLinguaUrl) {
      try {
        const resp = await fetch(`${llmLinguaUrl}/health`, { signal: AbortSignal.timeout(3000) });
        llmLinguaAvailable = resp.ok;
      } catch {
        llmLinguaAvailable = false;
      }
    }

    return {
      success:             true,
      heuristicAvailable:  true,
      llmLinguaAvailable,
      llmLinguaUrl:        llmLinguaUrl ?? null,
      activeBackend:       llmLinguaAvailable ? "llmlingua" : "heuristic",
    };
  });
}
