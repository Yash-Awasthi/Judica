/**
 * Memory Edit Routes — Phase 1.8
 *
 * User-facing CRUD for their stored memory facts.
 * Modeled after mem0's memory dashboard API (Apache 2.0, mem0ai/mem0)
 * and Letta/MemGPT's agent-managed memory operations (Apache 2.0).
 *
 * GET    /memory/facts           — list all facts (with optional tag filter)
 * POST   /memory/facts           — manually add a fact
 * PATCH  /memory/facts/:id       — edit a fact
 * DELETE /memory/facts/:id       — delete a fact
 * POST   /memory/facts/:id/confirm — reset decay score (confirm this memory is still valid)
 * GET    /memory/summary          — summary stats (count, avg decay, fading count)
 */

import type { FastifyPluginAsync } from "fastify";
import { db } from "../lib/drizzle.js";
import { memoryFacts } from "../db/schema/memoryFacts.js";
import { eq, and, asc, lt } from "drizzle-orm";
import { fastifyRequireAuth } from "../middleware/fastifyAuth.js";
import { AppError } from "../middleware/errorHandler.js";
import { z } from "zod";

const createFactSchema = z.object({
  fact: z.string().min(1).max(1000),
  tags: z.array(z.string().max(50)).max(20).default([]),
  conversationId: z.string().optional(),
});

const updateFactSchema = z.object({
  fact: z.string().min(1).max(1000).optional(),
  tags: z.array(z.string().max(50)).max(20).optional(),
  isShared: z.boolean().optional(),
});

const memoryEditPlugin: FastifyPluginAsync = async (fastify) => {
  /** GET /memory/facts — list user's memory facts */
  fastify.get("/memory/facts", { preHandler: fastifyRequireAuth }, async (request, _reply) => {
    const { tag, fading } = request.query as { tag?: string; fading?: string };
    const userId = request.userId!;

    let rows = await db
      .select()
      .from(memoryFacts)
      .where(eq(memoryFacts.userId, userId))
      .orderBy(asc(memoryFacts.decayScore));

    if (tag) {
      rows = rows.filter(r => r.tags.includes(tag));
    }
    if (fading === "true") {
      // "Fading" = decay score below 0.4 (near the Ebbinghaus forgetting threshold)
      rows = rows.filter(r => r.decayScore < 0.4);
    }

    return { facts: rows };
  });

  /** POST /memory/facts — manually add a fact */
  fastify.post("/memory/facts", { preHandler: fastifyRequireAuth }, async (request, reply) => {
    const parsed = createFactSchema.safeParse(request.body);
    if (!parsed.success) throw new AppError(400, "Invalid fact data", "VALIDATION_ERROR");

    const { fact, tags, conversationId } = parsed.data;
    const [created] = await db
      .insert(memoryFacts)
      .values({
        userId: request.userId!,
        fact,
        tags,
        source: "manual",
        conversationId: conversationId ?? null,
      })
      .returning();

    reply.code(201);
    return created;
  });

  /** PATCH /memory/facts/:id — edit a fact */
  fastify.patch("/memory/facts/:id", { preHandler: fastifyRequireAuth }, async (request, _reply) => {
    const { id } = request.params as { id: string };
    const userId = request.userId!;

    const [existing] = await db
      .select()
      .from(memoryFacts)
      .where(and(eq(memoryFacts.id, id), eq(memoryFacts.userId, userId)))
      .limit(1);

    if (!existing) throw new AppError(404, "Memory fact not found", "NOT_FOUND");

    const parsed = updateFactSchema.safeParse(request.body);
    if (!parsed.success) throw new AppError(400, "Invalid update data", "VALIDATION_ERROR");

    const updates: Partial<typeof memoryFacts.$inferInsert> = {
      updatedAt: new Date(),
    };
    if (parsed.data.fact !== undefined) updates.fact = parsed.data.fact;
    if (parsed.data.tags !== undefined) updates.tags = parsed.data.tags;
    if (parsed.data.isShared !== undefined) updates.isShared = parsed.data.isShared;

    const [updated] = await db
      .update(memoryFacts)
      .set(updates)
      .where(eq(memoryFacts.id, id))
      .returning();

    return updated;
  });

  /** DELETE /memory/facts/:id — delete a fact */
  fastify.delete("/memory/facts/:id", { preHandler: fastifyRequireAuth }, async (request, _reply) => {
    const { id } = request.params as { id: string };
    const userId = request.userId!;

    const [existing] = await db
      .select()
      .from(memoryFacts)
      .where(and(eq(memoryFacts.id, id), eq(memoryFacts.userId, userId)))
      .limit(1);

    if (!existing) throw new AppError(404, "Memory fact not found", "NOT_FOUND");

    await db.delete(memoryFacts).where(eq(memoryFacts.id, id));
    return { success: true };
  });

  /**
   * POST /memory/facts/:id/confirm
   * Reset decay score — user confirms this memory is still accurate.
   * Mirrors Anki's spaced repetition "confirm to keep" pattern.
   */
  fastify.post("/memory/facts/:id/confirm", { preHandler: fastifyRequireAuth }, async (request, _reply) => {
    const { id } = request.params as { id: string };
    const userId = request.userId!;

    const [existing] = await db
      .select()
      .from(memoryFacts)
      .where(and(eq(memoryFacts.id, id), eq(memoryFacts.userId, userId)))
      .limit(1);

    if (!existing) throw new AppError(404, "Memory fact not found", "NOT_FOUND");

    const [updated] = await db
      .update(memoryFacts)
      .set({ decayScore: 1.0, lastConfirmedAt: new Date(), updatedAt: new Date() })
      .where(eq(memoryFacts.id, id))
      .returning();

    return updated;
  });

  /** GET /memory/summary — stats overview */
  fastify.get("/memory/summary", { preHandler: fastifyRequireAuth }, async (request, _reply) => {
    const userId = request.userId!;

    const all = await db
      .select({ decayScore: memoryFacts.decayScore })
      .from(memoryFacts)
      .where(eq(memoryFacts.userId, userId));

    const fading = all.filter(r => r.decayScore < 0.4).length;
    const avgDecay = all.length > 0
      ? all.reduce((s, r) => s + r.decayScore, 0) / all.length
      : 1.0;

    return {
      total: all.length,
      fading,
      avgDecayScore: Math.round(avgDecay * 100) / 100,
    };
  });
};

export default memoryEditPlugin;
