/**
 * Blind Council Mode — Phase 7.10
 *
 * Routes:
 *   POST /blind-council/run — Run a question through the blind council
 */

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { runBlindCouncil } from "../lib/blindCouncil.js";
import { env } from "../config/env.js";

const defaultProvider = (name: string) => ({
  name,
  type: "api" as const,
  apiKey: env.OPENAI_API_KEY ?? env.ANTHROPIC_API_KEY ?? "",
  model: env.OPENAI_API_KEY ? "gpt-4o-mini" : "claude-3-haiku-20240307",
});

const runSchema = z.object({
  question:    z.string().min(1).max(10_000),
  /** Number of anonymous reviewers (2–8). Default: 3 */
  memberCount: z.number().int().min(2).max(8).optional().default(3),
  /** Include the alias→model map in the response (admin use). Default: false */
  revealAliases: z.boolean().optional().default(false),
});

export async function blindCouncilPlugin(app: FastifyInstance) {

  /**
   * POST /blind-council/run
   * Run a question through the blind council. Members answer without knowing
   * each other's identities, preventing anchoring bias.
   */
  app.post("/blind-council/run", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const parsed = runSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });

    const { question, memberCount, revealAliases } = parsed.data;

    const members = Array.from({ length: memberCount }, (_, i) =>
      defaultProvider(`member-${i}`)
    );
    const synthesizer = defaultProvider("synthesizer");

    const result = await runBlindCouncil(question, members, synthesizer);

    return {
      success:   true,
      question:  question.slice(0, 100),
      synthesis: result.synthesis,
      responses: result.responses,
      aliasMap:  revealAliases ? result.aliasMap : undefined,
    };
  });
}
