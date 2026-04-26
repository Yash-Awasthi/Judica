/**
 * Hypothesis Tracker Routes — Phase 1.12
 *
 * CRUD for user hypothesis forecasts.
 * Modeled after:
 * - Metaculus (metaculus.com) — community forecasting API pattern
 * - Fatebook (MIT, Sage-Future/fatebook) — personal prediction journal
 *
 * GET    /hypotheses            — list all hypotheses (with optional status filter)
 * POST   /hypotheses            — create a new hypothesis
 * PATCH  /hypotheses/:id        — update probability or details
 * DELETE /hypotheses/:id        — delete a hypothesis
 * POST   /hypotheses/:id/resolve — mark as resolved_true / resolved_false / voided
 */

import type { FastifyPluginAsync } from "fastify";
import { db } from "../lib/drizzle.js";
import { hypotheses } from "../db/schema/hypotheses.js";
import { eq, and, desc } from "drizzle-orm";
import { fastifyRequireAuth } from "../middleware/fastifyAuth.js";
import { z } from "zod";

const createSchema = z.object({
  claim: z.string().min(5).max(1000),
  probability: z.number().min(0).max(1).default(0.5),
  conversationId: z.string().uuid().optional(),
  resolveBy: z.string().datetime().optional(),
  tags: z.array(z.string().max(50)).max(10).optional(),
  isPublic: z.boolean().default(false),
});

const updateSchema = z.object({
  claim: z.string().min(5).max(1000).optional(),
  currentProbability: z.number().min(0).max(1).optional(),
  resolveBy: z.string().datetime().optional(),
  tags: z.array(z.string().max(50)).max(10).optional(),
  isPublic: z.boolean().optional(),
});

const resolveSchema = z.object({
  outcome: z.enum(["resolved_true", "resolved_false", "voided"]),
  resolutionNote: z.string().max(2000).optional(),
});

export const hypothesesPlugin: FastifyPluginAsync = async (fastify) => {
  fastify.addHook("preHandler", fastifyRequireAuth);

  // GET /hypotheses
  fastify.get("/hypotheses", { config: { rateLimit: { max: 100, timeWindow: "1 minute" } } }, async (request: any) => {
    const userId = request.user.userId;
    const { status } = (request.query as any) ?? {};

    const conditions = [eq(hypotheses.userId, userId)];
    if (status) conditions.push(eq(hypotheses.status, status));

    const rows = await db
      .select()
      .from(hypotheses)
      .where(and(...conditions))
      .orderBy(desc(hypotheses.createdAt));

    return { hypotheses: rows };
  });

  // POST /hypotheses
  fastify.post("/hypotheses", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (request: any, reply: any) => {
    const userId = request.user.userId;
    const body = createSchema.safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({ error: "Validation failed", details: body.error.issues });
    }
    const { claim, probability, conversationId, resolveBy, tags, isPublic } = body.data;

    const [row] = await db
      .insert(hypotheses)
      .values({
        userId,
        claim,
        probability,
        currentProbability: probability,
        conversationId: conversationId ?? null,
        resolveBy: resolveBy ? new Date(resolveBy) : null,
        tags: tags ?? null,
        isPublic,
      })
      .returning();

    return reply.code(201).send({ hypothesis: row });
  });

  // PATCH /hypotheses/:id
  fastify.patch("/hypotheses/:id", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (request: any, reply: any) => {
    const userId = request.user.userId;
    const { id } = request.params as { id: string };
    const body = updateSchema.safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({ error: "Validation failed", details: body.error.issues });
    }

    const update: Record<string, unknown> = { updatedAt: new Date() };
    if (body.data.claim !== undefined) update.claim = body.data.claim;
    if (body.data.currentProbability !== undefined) update.currentProbability = body.data.currentProbability;
    if (body.data.resolveBy !== undefined) update.resolveBy = new Date(body.data.resolveBy);
    if (body.data.tags !== undefined) update.tags = body.data.tags;
    if (body.data.isPublic !== undefined) update.isPublic = body.data.isPublic;

    const [updated] = await db
      .update(hypotheses)
      .set(update)
      .where(and(eq(hypotheses.id, id), eq(hypotheses.userId, userId)))
      .returning();

    if (!updated) return reply.code(404).send({ error: "Hypothesis not found" });
    return { hypothesis: updated };
  });

  // DELETE /hypotheses/:id
  fastify.delete("/hypotheses/:id", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (request: any, reply: any) => {
    const userId = request.user.userId;
    const { id } = request.params as { id: string };

    const [deleted] = await db
      .delete(hypotheses)
      .where(and(eq(hypotheses.id, id), eq(hypotheses.userId, userId)))
      .returning();

    if (!deleted) return reply.code(404).send({ error: "Hypothesis not found" });
    return { success: true };
  });

  // POST /hypotheses/:id/resolve
  fastify.post("/hypotheses/:id/resolve", { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } }, async (request: any, reply: any) => {
    const userId = request.user.userId;
    const { id } = request.params as { id: string };
    const body = resolveSchema.safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({ error: "Validation failed", details: body.error.issues });
    }

    const [updated] = await db
      .update(hypotheses)
      .set({
        status: body.data.outcome,
        resolutionNote: body.data.resolutionNote ?? null,
        resolvedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(and(eq(hypotheses.id, id), eq(hypotheses.userId, userId)))
      .returning();

    if (!updated) return reply.code(404).send({ error: "Hypothesis not found" });
    return { hypothesis: updated };
  });
};
