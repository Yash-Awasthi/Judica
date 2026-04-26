/**
 * Workflow Execution Logs routes — Phase 4.10
 *
 * Step-level event logs per workflow run:
 * - Write log entries (for the executor to call)
 * - Query logs by run, workflow, or user
 * - Aggregate stats: avg duration, error rate per node
 *
 * Inspired by Airflow task logs + LangSmith execution traces.
 */

import type { FastifyInstance } from "fastify";
import { db } from "../lib/drizzle.js";
import { workflowRunLogs } from "../db/schema/workflowRunLogs.js";
import { workflowRuns } from "../db/schema/workflows.js";
import { eq, and, desc, sql } from "drizzle-orm";
import { z } from "zod";

// ─── Schemas ─────────────────────────────────────────────────────────────────

const logEntrySchema = z.object({
  runId:      z.string().min(1),
  workflowId: z.string().min(1),
  nodeId:     z.string().optional(),
  nodeType:   z.string().optional(),
  eventType:  z.enum(["node_start", "node_complete", "node_error", "human_gate_pending", "workflow_complete", "workflow_error", "info"]),
  status:     z.enum(["info", "success", "error", "warning"]).optional(),
  message:    z.string().max(2000).optional(),
  data:       z.record(z.string(), z.unknown()).optional(),
  durationMs: z.number().min(0).optional(),
});

const batchLogSchema = z.object({
  entries: z.array(logEntrySchema).min(1).max(100),
});

// ─── Routes ──────────────────────────────────────────────────────────────────

export async function workflowRunLogsPlugin(app: FastifyInstance) {

  /**
   * POST /workflow-logs
   * Write a single log entry.
   */
  app.post("/workflow-logs", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const parsed = logEntrySchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });

    const { status, data, ...rest } = parsed.data;
    const [entry] = await db
      .insert(workflowRunLogs)
      .values({ userId, status: status ?? "info", data: data ?? {}, ...rest })
      .returning();

    return reply.status(201).send({ success: true, entry });
  });

  /**
   * POST /workflow-logs/batch
   * Write multiple log entries in one call (used by the executor).
   */
  app.post("/workflow-logs/batch", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const parsed = batchLogSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });

    const rows = parsed.data.entries.map(({ status, data, ...rest }) => ({
      userId,
      status: status ?? "info",
      data: data ?? {},
      ...rest,
    }));

    const inserted = await db.insert(workflowRunLogs).values(rows).returning({ id: workflowRunLogs.id });
    return reply.status(201).send({ success: true, count: inserted.length });
  });

  /**
   * GET /workflow-logs/run/:runId
   * All log entries for a specific workflow run.
   */
  app.get("/workflow-logs/run/:runId", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const { runId } = req.params as { runId: string };

    const entries = await db
      .select()
      .from(workflowRunLogs)
      .where(and(eq(workflowRunLogs.runId, runId), eq(workflowRunLogs.userId, userId)))
      .orderBy(workflowRunLogs.createdAt);

    return { success: true, runId, entries, count: entries.length };
  });

  /**
   * GET /workflow-logs/workflow/:workflowId
   * Log entries for all runs of a workflow (most recent first, paginated).
   */
  app.get("/workflow-logs/workflow/:workflowId", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const { workflowId } = req.params as { workflowId: string };
    const limit = Math.min(Number((req.query as any).limit ?? 100), 500);
    const offset = Number((req.query as any).offset ?? 0);

    const entries = await db
      .select()
      .from(workflowRunLogs)
      .where(and(eq(workflowRunLogs.workflowId, workflowId), eq(workflowRunLogs.userId, userId)))
      .orderBy(desc(workflowRunLogs.createdAt))
      .limit(limit)
      .offset(offset);

    return { success: true, workflowId, entries, count: entries.length };
  });

  /**
   * GET /workflow-logs/stats/:workflowId
   * Aggregated execution stats: avg duration, error rate, node breakdown.
   */
  app.get("/workflow-logs/stats/:workflowId", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const { workflowId } = req.params as { workflowId: string };

    // Node-level duration + error stats
    const nodeStats = await db
      .select({
        nodeId:      workflowRunLogs.nodeId,
        nodeType:    workflowRunLogs.nodeType,
        eventType:   workflowRunLogs.eventType,
        count:       sql<number>`count(*)::int`,
        avgDuration: sql<number>`round(avg(${workflowRunLogs.durationMs}))::int`,
        maxDuration: sql<number>`max(${workflowRunLogs.durationMs})::int`,
      })
      .from(workflowRunLogs)
      .where(and(eq(workflowRunLogs.workflowId, workflowId), eq(workflowRunLogs.userId, userId)))
      .groupBy(workflowRunLogs.nodeId, workflowRunLogs.nodeType, workflowRunLogs.eventType);

    const totalRuns = await db
      .select({ count: sql<number>`count(distinct ${workflowRunLogs.runId})::int` })
      .from(workflowRunLogs)
      .where(and(eq(workflowRunLogs.workflowId, workflowId), eq(workflowRunLogs.userId, userId)));

    const errorCount = nodeStats.filter((s) => s.eventType === "node_error" || s.eventType === "workflow_error")
      .reduce((sum, s) => sum + s.count, 0);
    const totalEvents = nodeStats.reduce((sum, s) => sum + s.count, 0);

    return {
      success: true,
      workflowId,
      totalRuns: totalRuns[0]?.count ?? 0,
      totalEvents,
      errorCount,
      errorRate: totalEvents > 0 ? (errorCount / totalEvents) : 0,
      nodeStats,
    };
  });

  /**
   * DELETE /workflow-logs/run/:runId
   * Delete all logs for a specific run.
   */
  app.delete("/workflow-logs/run/:runId", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const { runId } = req.params as { runId: string };
    await db
      .delete(workflowRunLogs)
      .where(and(eq(workflowRunLogs.runId, runId), eq(workflowRunLogs.userId, userId)));

    return { success: true };
  });
}
