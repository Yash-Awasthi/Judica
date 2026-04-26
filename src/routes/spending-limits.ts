/**
 * Spending Limits Routes — Phase 1.16
 *
 * GET    /spending-limits/me     — get my current spending limit and usage
 * PUT    /spending-limits/me     — set or update my spending limit
 * DELETE /spending-limits/me     — remove my spending limit
 */

import type { FastifyPluginAsync } from "fastify";
import { db } from "../lib/drizzle.js";
import { spendingLimits } from "../db/schema/spendingLimits.js";
import { eq } from "drizzle-orm";
import { fastifyRequireAuth } from "../middleware/fastifyAuth.js";
import { z } from "zod";

const upsertSchema = z.object({
  capUsd: z.number().positive().max(10000),
  period: z.enum(["daily", "weekly", "monthly"]).default("monthly"),
});

function nextResetDate(period: string): Date {
  const now = new Date();
  if (period === "daily") {
    const d = new Date(now);
    d.setUTCDate(d.getUTCDate() + 1);
    d.setUTCHours(0, 0, 0, 0);
    return d;
  }
  if (period === "weekly") {
    const d = new Date(now);
    d.setUTCDate(d.getUTCDate() + (7 - d.getUTCDay()));
    d.setUTCHours(0, 0, 0, 0);
    return d;
  }
  const d = new Date(now);
  d.setUTCMonth(d.getUTCMonth() + 1, 1);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

export const spendingLimitsPlugin: FastifyPluginAsync = async (fastify) => {
  fastify.addHook("preHandler", fastifyRequireAuth);

  fastify.get("/spending-limits/me", async (request: any, reply: any) => {
    const [limit] = await db
      .select()
      .from(spendingLimits)
      .where(eq(spendingLimits.userId, request.user.userId))
      .limit(1);

    if (!limit) return reply.code(404).send({ error: "No spending limit configured" });
    return { limit };
  });

  fastify.put("/spending-limits/me", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (request: any, reply: any) => {
    const body = upsertSchema.safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({ error: "Validation failed", details: body.error.issues });
    }
    const { capUsd, period } = body.data;
    const userId = request.user.userId;

    const [existing] = await db
      .select()
      .from(spendingLimits)
      .where(eq(spendingLimits.userId, userId))
      .limit(1);

    if (existing) {
      const [updated] = await db
        .update(spendingLimits)
        .set({ capUsd, period, updatedAt: new Date() })
        .where(eq(spendingLimits.userId, userId))
        .returning();
      return { limit: updated };
    }

    const [created] = await db
      .insert(spendingLimits)
      .values({
        userId,
        capUsd,
        period,
        currentSpendUsd: 0,
        periodResetsAt: nextResetDate(period),
      })
      .returning();

    return reply.code(201).send({ limit: created });
  });

  fastify.delete("/spending-limits/me", async (request: any, reply: any) => {
    const [deleted] = await db
      .delete(spendingLimits)
      .where(eq(spendingLimits.userId, request.user.userId))
      .returning();

    if (!deleted) return reply.code(404).send({ error: "No spending limit to remove" });
    return { success: true };
  });
};
