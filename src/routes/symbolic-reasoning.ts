/**
 * Symbolic Reasoning Engine — Phase 7.7
 *
 * Routes:
 *   POST /symbolic/forward-chain     — Derive new facts from rules + known facts
 *   POST /symbolic/check-consistency — Check if a response violates symbolic rules
 */

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { forwardChain, checkConsistency } from "../lib/symbolicReasoning.js";
import { env } from "../config/env.js";

const provider = {
  name: "openai" as const,
  type: "api" as const,
  apiKey: env.OPENAI_API_KEY ?? env.ANTHROPIC_API_KEY ?? "",
  model: env.OPENAI_API_KEY ? "gpt-4o-mini" : "claude-3-haiku-20240307",
};

const ruleSchema = z.object({
  id:         z.string().min(1).max(100),
  condition:  z.string().min(1).max(500),
  conclusion: z.string().min(1).max(500),
});

const chainSchema = z.object({
  facts: z.array(z.string().min(1).max(500)).min(1).max(200),
  rules: z.array(ruleSchema).min(1).max(100),
});

const consistencySchema = z.object({
  response: z.string().min(1).max(10_000),
  rules:    z.array(ruleSchema).min(1).max(20),
});

export async function symbolicReasoningPlugin(app: FastifyInstance) {

  /**
   * POST /symbolic/forward-chain
   * Runs forward chaining: derives all facts deducible from the given rules.
   */
  app.post("/symbolic/forward-chain", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const parsed = chainSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });

    const result = await forwardChain(parsed.data.facts, parsed.data.rules, provider);

    return {
      success: true,
      ...result,
    };
  });

  /**
   * POST /symbolic/check-consistency
   * Checks whether a response is consistent with a set of symbolic rules.
   */
  app.post("/symbolic/check-consistency", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const parsed = consistencySchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });

    const result = await checkConsistency(parsed.data.response, parsed.data.rules, provider);

    return { success: true, ...result };
  });
}
