/**
 * Prompt Optimisation routes — Phase 2.12
 *
 * DSPy-inspired automatic prompt improvement from feedback history.
 * User-initiated only. Shows cost estimate + diff before applying.
 */

import { FastifyInstance } from "fastify";
import { estimateOptimisationCost, optimiseAgentPrompt } from "../lib/promptOptimisation.js";
import { db } from "../lib/drizzle.js";
import { council } from "../db/schema/council.js";
import { eq, and } from "drizzle-orm";
import { z } from "zod";

const applySchema = z.object({
  proposedPrompt: z.string().min(1),
});

export async function promptOptimisationPlugin(app: FastifyInstance) {
  // GET /prompt-optimisation/:agentId/estimate — cost/token estimate (no run)
  app.get("/prompt-optimisation/:agentId/estimate", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const agentId = (req.params as any).agentId as string;
    const estimate = await estimateOptimisationCost(userId, agentId);

    return {
      success:        true,
      ...estimate,
      message: estimate.eligible
        ? `Ready. Estimated ${estimate.tokenEstimate} tokens.`
        : `Need ${50 - estimate.exampleCount} more rated responses.`,
    };
  });

  // POST /prompt-optimisation/:agentId/run — run optimisation, returns diff (no auto-apply)
  app.post("/prompt-optimisation/:agentId/run", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const agentId = (req.params as any).agentId as string;
    const result = await optimiseAgentPrompt(userId, agentId);

    if (!result) {
      return reply.status(422).send({ error: "Insufficient rated responses (need 50+)." });
    }

    return { success: true, ...result };
  });

  // POST /prompt-optimisation/:agentId/apply — apply proposed prompt (user explicitly approves)
  app.post("/prompt-optimisation/:agentId/apply", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const agentId = (req.params as any).agentId as string;
    const parsed = applySchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });

    // Load current prompt for backup
    const [current] = await db
      .select({ systemPrompt: (council as any).systemPrompt })
      .from(council as any)
      .where(and(eq((council as any).userId, userId), eq((council as any).id, agentId)))
      .limit(1);

    const backup = current?.systemPrompt ?? "";

    // Apply proposed prompt
    await db
      .update(council as any)
      .set({ systemPrompt: parsed.data.proposedPrompt })
      .where(and(eq((council as any).userId, userId), eq((council as any).id, agentId)));

    return { success: true, backup, applied: parsed.data.proposedPrompt };
  });

  // POST /prompt-optimisation/:agentId/revert — revert to backup prompt
  app.post("/prompt-optimisation/:agentId/revert", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const agentId = (req.params as any).agentId as string;
    const parsed = z.object({ backup: z.string() }).safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: "backup field required" });

    await db
      .update(council as any)
      .set({ systemPrompt: parsed.data.backup })
      .where(and(eq((council as any).userId, userId), eq((council as any).id, agentId)));

    return { success: true, reverted: parsed.data.backup };
  });
}
