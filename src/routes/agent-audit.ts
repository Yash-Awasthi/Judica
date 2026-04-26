/**
 * Agent Action Audit Log routes — Phase 4.19
 *
 * Per-agent-action audit trail inspired by Agno (agno-agi/agno):
 * - Log every meaningful agent action with timing and context
 * - Query by agent, action type, entity, or time range
 * - Aggregate stats: actions per agent, error rates, avg latency
 *
 * Inspired by:
 * - Agno (agno-agi/agno, 25k stars) — observability for agent actions
 * - LangSmith — per-action trace logging
 * - OpenTelemetry spans — structured action metadata
 */

import type { FastifyInstance } from "fastify";
import { db } from "../lib/drizzle.js";
import { agentActionLogs } from "../db/schema/agentActionLogs.js";
import { eq, and, desc, gte, lte, sql } from "drizzle-orm";
import { z } from "zod";

// ─── Schema ───────────────────────────────────────────────────────────────────

const logActionSchema = z.object({
  agentId:    z.string().min(1).max(100),
  action:     z.string().min(1).max(100),
  entityType: z.string().max(50).optional(),
  entityId:   z.string().max(200).optional(),
  meta:       z.record(z.string(), z.unknown()).optional(),
  durationMs: z.number().min(0).optional(),
  status:     z.enum(["success", "error", "skipped"]).optional(),
  error:      z.string().max(2000).optional(),
});

const batchLogSchema = z.object({
  entries: z.array(logActionSchema).min(1).max(50),
});

// ─── Helper: public log function for other modules to use ────────────────────

export async function logAgentAction(
  userId: number,
  agentId: string,
  action: string,
  opts: {
    entityType?: string;
    entityId?: string;
    meta?: Record<string, unknown>;
    durationMs?: number;
    status?: "success" | "error" | "skipped";
    error?: string;
  } = {},
): Promise<void> {
  try {
    await db.insert(agentActionLogs).values({
      userId,
      agentId,
      action,
      entityType: opts.entityType,
      entityId: opts.entityId,
      meta: opts.meta ?? {},
      durationMs: opts.durationMs,
      status: opts.status ?? "success",
      error: opts.error,
    });
  } catch { /* never throw from audit logger */ }
}

// ─── Routes ──────────────────────────────────────────────────────────────────

export async function agentAuditPlugin(app: FastifyInstance) {

  /**
   * POST /agent-audit
   * Log a single agent action.
   */
  app.post("/agent-audit", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const parsed = logActionSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });

    const { meta, status, ...rest } = parsed.data;
    const [entry] = await db
      .insert(agentActionLogs)
      .values({ userId, meta: meta ?? {}, status: status ?? "success", ...rest })
      .returning();

    return reply.status(201).send({ success: true, entry });
  });

  /**
   * POST /agent-audit/batch
   * Batch-log multiple agent actions.
   */
  app.post("/agent-audit/batch", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const parsed = batchLogSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });

    const rows = parsed.data.entries.map(({ meta, status, ...rest }) => ({
      userId,
      meta: meta ?? {},
      status: status ?? "success",
      ...rest,
    }));

    const inserted = await db.insert(agentActionLogs).values(rows).returning({ id: agentActionLogs.id });
    return reply.status(201).send({ success: true, count: inserted.length });
  });

  /**
   * GET /agent-audit
   * Query agent action logs with optional filters.
   */
  app.get("/agent-audit", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const {
      agentId,
      action,
      entityType,
      status,
      since,
      until,
      limit: rawLimit,
      offset: rawOffset,
    } = req.query as Record<string, string>;

    const limit = Math.min(Number(rawLimit ?? 50), 500);
    const offset = Number(rawOffset ?? 0);

    // Build filters
    const filters = [eq(agentActionLogs.userId, userId)];
    if (agentId)    filters.push(eq(agentActionLogs.agentId, agentId));
    if (action)     filters.push(eq(agentActionLogs.action, action));
    if (entityType) filters.push(eq(agentActionLogs.entityType, entityType));
    if (status)     filters.push(eq(agentActionLogs.status, status));
    if (since)      filters.push(gte(agentActionLogs.createdAt, new Date(since)));
    if (until)      filters.push(lte(agentActionLogs.createdAt, new Date(until)));

    const entries = await db
      .select()
      .from(agentActionLogs)
      .where(and(...filters))
      .orderBy(desc(agentActionLogs.createdAt))
      .limit(limit)
      .offset(offset);

    return { success: true, entries, count: entries.length };
  });

  /**
   * GET /agent-audit/stats
   * Aggregated action stats per agent.
   */
  app.get("/agent-audit/stats", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const stats = await db
      .select({
        agentId:     agentActionLogs.agentId,
        action:      agentActionLogs.action,
        status:      agentActionLogs.status,
        count:       sql<number>`count(*)::int`,
        avgDuration: sql<number>`round(avg(${agentActionLogs.durationMs}))::int`,
        maxDuration: sql<number>`max(${agentActionLogs.durationMs})::int`,
      })
      .from(agentActionLogs)
      .where(eq(agentActionLogs.userId, userId))
      .groupBy(agentActionLogs.agentId, agentActionLogs.action, agentActionLogs.status);

    // Compute per-agent totals
    const perAgent = new Map<string, { total: number; errors: number; actions: Set<string> }>();
    for (const s of stats) {
      if (!perAgent.has(s.agentId)) perAgent.set(s.agentId, { total: 0, errors: 0, actions: new Set() });
      const a = perAgent.get(s.agentId)!;
      a.total += s.count;
      if (s.status === "error") a.errors += s.count;
      a.actions.add(s.action);
    }

    const agentSummary = [...perAgent.entries()].map(([agentId, v]) => ({
      agentId,
      totalActions: v.total,
      errorCount: v.errors,
      errorRate: v.total > 0 ? (v.errors / v.total) : 0,
      uniqueActionTypes: v.actions.size,
    }));

    return { success: true, detailedStats: stats, agentSummary };
  });

  /**
   * GET /agent-audit/timeline/:agentId
   * Recent timeline for a specific agent.
   */
  app.get("/agent-audit/timeline/:agentId", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const { agentId } = req.params as { agentId: string };
    const entries = await db
      .select()
      .from(agentActionLogs)
      .where(and(eq(agentActionLogs.userId, userId), eq(agentActionLogs.agentId, agentId)))
      .orderBy(desc(agentActionLogs.createdAt))
      .limit(100);

    return { success: true, agentId, entries, count: entries.length };
  });

  /**
   * DELETE /agent-audit
   * Purge audit logs older than N days for the user.
   */
  app.delete("/agent-audit", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const { olderThanDays = "30" } = req.query as { olderThanDays?: string };
    const cutoff = new Date(Date.now() - Number(olderThanDays) * 86400_000);

    await db
      .delete(agentActionLogs)
      .where(and(eq(agentActionLogs.userId, userId), lte(agentActionLogs.createdAt, cutoff)));

    return { success: true, purgedBefore: cutoff.toISOString() };
  });
}
