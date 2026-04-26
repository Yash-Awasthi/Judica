/**
 * Council Member Evolution — Phase 7.13
 *
 * Routes:
 *   GET  /member-evolution/:model   — Get evolution profile for a model
 *   POST /member-evolution/recompute — Recompute profile from feedback DB
 *   POST /member-evolution/apply    — Apply evolution hint to a system prompt
 */

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  getEvolutionProfile,
  recomputeEvolution,
  applyEvolutionHint,
} from "../lib/memberEvolution.js";

const applySchema = z.object({
  model:        z.string().min(1).max(200),
  systemPrompt: z.string().max(20_000).optional().default(""),
});

const recomputeSchema = z.object({
  model: z.string().min(1).max(200),
});

export async function memberEvolutionPlugin(app: FastifyInstance) {

  app.get("/member-evolution/:model", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const { model } = req.params as { model: string };
    const profile = await getEvolutionProfile(userId, model);

    if (!profile) {
      return { success: true, profile: null, message: "No evolution data yet for this model" };
    }

    return { success: true, profile };
  });

  app.post("/member-evolution/recompute", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const parsed = recomputeSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });

    const profile = await recomputeEvolution(userId, parsed.data.model);
    return { success: true, profile };
  });

  app.post("/member-evolution/apply", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const parsed = applySchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });

    const { model, systemPrompt } = parsed.data;
    const profile = await getEvolutionProfile(userId, model);
    const adapted = applyEvolutionHint(systemPrompt, profile);

    return {
      success:     true,
      model,
      adapted,
      hintApplied: profile?.systemPromptHint ?? null,
    };
  });
}
