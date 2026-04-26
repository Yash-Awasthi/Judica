/**
 * Agent Memory routes — Phase 2.10
 *
 * Endpoints for managing per-archetype persistent memories.
 * Each scope is searchable and editable independently.
 */

import { FastifyInstance } from "fastify";
import { db } from "../lib/drizzle.js";
import { agentMemories } from "../db/schema/agentMemories.js";
import { eq, and } from "drizzle-orm";
import { z } from "zod";

const createSchema = z.object({
  agentId:        z.string().min(1),
  agentLabel:     z.string().optional(),
  fact:           z.string().min(1).max(2000),
  conversationId: z.string().optional(),
  confidence:     z.number().min(0).max(1).optional(),
});

export async function agentMemoriesPlugin(app: FastifyInstance) {
  // GET /agent-memories/:agentId — list memories for an archetype
  app.get("/agent-memories/:agentId", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const agentId = (req.params as any).agentId as string;
    const rows = await db
      .select()
      .from(agentMemories)
      .where(and(
        eq(agentMemories.userId, userId),
        eq(agentMemories.agentId, agentId),
      ));

    return { success: true, memories: rows };
  });

  // POST /agent-memories — store a new agent memory fact
  app.post("/agent-memories", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });

    const { agentId, agentLabel, fact, conversationId, confidence = 1.0 } = parsed.data;

    const [row] = await db
      .insert(agentMemories)
      .values({ userId, agentId, agentLabel, fact, conversationId, confidence, decayScore: 1.0 })
      .returning();

    return reply.status(201).send({ success: true, memory: row });
  });

  // DELETE /agent-memories/:id — delete a specific agent memory
  app.delete("/agent-memories/:id", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const id = Number((req.params as any).id);
    if (isNaN(id)) return reply.status(400).send({ error: "Invalid id" });

    const [deleted] = await db
      .delete(agentMemories)
      .where(and(eq(agentMemories.id, id), eq(agentMemories.userId, userId)))
      .returning({ id: agentMemories.id });

    if (!deleted) return reply.status(404).send({ error: "Not found" });

    return { success: true };
  });

  // DELETE /agent-memories/agent/:agentId — clear all memories for an archetype
  app.delete("/agent-memories/agent/:agentId", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const agentId = (req.params as any).agentId as string;
    await db
      .delete(agentMemories)
      .where(and(
        eq(agentMemories.userId, userId),
        eq(agentMemories.agentId, agentId),
      ));

    return { success: true };
  });
}
