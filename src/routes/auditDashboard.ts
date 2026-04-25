/**
 * Query Audit Dashboard Routes
 *
 * Endpoints:
 *   GET    /api/audit/queries         — paginated query list with filters (admin)
 *   GET    /api/audit/queries/:id     — full detail of one query with trace (admin)
 *   GET    /api/audit/stats           — aggregate stats (admin)
 *   GET    /api/audit/export          — CSV export with date range filter (admin)
 *   DELETE /api/audit/queries/:id     — delete audit record (admin)
 */

import type { FastifyPluginAsync } from "fastify";
import { fastifyRequireAdmin } from "../middleware/fastifyAuth.js";
import { db } from "../lib/drizzle.js";
import { auditLogs } from "../db/schema/conversations.js";
import { traces } from "../db/schema/traces.js";
import { users } from "../db/schema/users.js";
import { sql, desc, asc, eq, and, gte, lte, isNotNull, count } from "drizzle-orm";
import { AppError } from "../middleware/errorHandler.js";

/** Parse a value to a safe integer, returning fallback on NaN. */
function safeInt(value: string | number | undefined, fallback: number): number {
  const n = typeof value === "number" ? value : parseInt(String(value ?? ""), 10);
  return Number.isNaN(n) ? fallback : n;
}

/** Parse a date string; throw 400 on invalid dates. */
function safeDate(value: string | undefined): Date | undefined {
  if (!value) return undefined;
  const d = new Date(value);
  if (isNaN(d.getTime())) throw new AppError(400, `Invalid date: ${value}`);
  return d;
}

/** Escape a value for safe CSV embedding (RFC 4180). */
function csvEscape(value: unknown): string {
  const str = value === null || value === undefined ? "" : String(value);
  if (str.includes(",") || str.includes('"') || str.includes("\n") || str.includes("\r")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

const auditDashboardPlugin: FastifyPluginAsync = async (fastify) => {
  // All routes in this plugin require admin role
  fastify.addHook("preHandler", fastifyRequireAdmin);

  // ─── GET /queries — paginated list with filters ───────────────────────────

  fastify.get("/queries", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (request, _reply) => {
    const {
      userId,
      tenantId,
      dateFrom,
      dateTo,
      model,
      hasError,
      page,
      limit: rawLimit,
    } = request.query as {
      userId?: string;
      tenantId?: string;
      dateFrom?: string;
      dateTo?: string;
      model?: string;
      hasError?: string;
      page?: string;
      limit?: string;
    };

    const pageNum = Math.max(1, safeInt(page, 1));
    const limitNum = Math.min(Math.max(1, safeInt(rawLimit, 20)), 200);
    const offset = (pageNum - 1) * limitNum;

    const conditions = [];

    if (userId) {
      const uid = safeInt(userId, NaN);
      if (Number.isNaN(uid)) throw new AppError(400, "userId must be numeric");
      conditions.push(eq(auditLogs.userId, uid));
    }

    if (model) {
      conditions.push(eq(auditLogs.modelName, model));
    }

    const fromDate = safeDate(dateFrom);
    const toDate = safeDate(dateTo);
    if (fromDate) conditions.push(gte(auditLogs.createdAt, fromDate));
    if (toDate) conditions.push(lte(auditLogs.createdAt, toDate));

    // hasError filter: check metadata->>'error' IS NOT NULL
    if (hasError === "true") {
      conditions.push(sql`${auditLogs.metadata}->>'error' IS NOT NULL`);
    } else if (hasError === "false") {
      conditions.push(sql`(${auditLogs.metadata}->>'error') IS NULL`);
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    // Run count and data queries in parallel
    const [countResult, rows] = await Promise.all([
      db
        .select({ total: count() })
        .from(auditLogs)
        .where(whereClause),
      db
        .select({
          id: auditLogs.id,
          userId: auditLogs.userId,
          conversationId: auditLogs.conversationId,
          model: auditLogs.modelName,
          query: auditLogs.prompt,
          tokensUsed: sql<number>`COALESCE(${auditLogs.tokensIn}, 0) + COALESCE(${auditLogs.tokensOut}, 0)`,
          latencyMs: auditLogs.latencyMs,
          hasError: sql<boolean>`(${auditLogs.metadata}->>'error') IS NOT NULL`,
          createdAt: auditLogs.createdAt,
        })
        .from(auditLogs)
        .where(whereClause)
        .orderBy(desc(auditLogs.createdAt))
        .limit(limitNum)
        .offset(offset),
    ]);

    const total = countResult[0]?.total ?? 0;

    return {
      queries: rows.map((r) => ({
        id: r.id,
        userId: r.userId,
        tenantId: null, // tenant column not yet in schema
        query: r.query,
        model: r.model,
        tokensUsed: r.tokensUsed,
        latencyMs: r.latencyMs,
        hasError: r.hasError,
        createdAt: r.createdAt,
      })),
      total,
      page: pageNum,
      limit: limitNum,
    };
  });

  // ─── GET /queries/:id — full detail with trace ────────────────────────────

  fastify.get("/queries/:id", async (request, _reply) => {
    const { id } = request.params as { id: string };
    const idNum = safeInt(id, NaN);
    if (Number.isNaN(idNum)) throw new AppError(400, "id must be numeric");

    const [row] = await db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.id, idNum))
      .limit(1);

    if (!row) throw new AppError(404, "Audit record not found");

    // Fetch associated trace if conversationId is available
    let trace: typeof traces.$inferSelect | null = null;
    if (row.conversationId) {
      const [traceRow] = await db
        .select()
        .from(traces)
        .where(eq(traces.conversationId, row.conversationId))
        .orderBy(desc(traces.createdAt))
        .limit(1);
      trace = traceRow ?? null;
    }

    return {
      query: {
        id: row.id,
        userId: row.userId,
        conversationId: row.conversationId,
        sessionId: row.sessionId,
        model: row.modelName,
        prompt: row.prompt,
        response: row.response,
        tokensIn: row.tokensIn,
        tokensOut: row.tokensOut,
        latencyMs: row.latencyMs,
        metadata: row.metadata,
        hasError: (row.metadata as Record<string, unknown> | null)?.error !== null && (row.metadata as Record<string, unknown> | null)?.error !== undefined,
        createdAt: row.createdAt,
      },
      trace: trace
        ? {
            id: trace.id,
            type: trace.type,
            steps: trace.steps,
            totalLatencyMs: trace.totalLatencyMs,
            totalTokens: trace.totalTokens,
            totalCostUsd: trace.totalCostUsd,
            createdAt: trace.createdAt,
          }
        : null,
    };
  });

  // ─── GET /stats — aggregate stats ─────────────────────────────────────────

  fastify.get("/stats", async (_request, _reply) => {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    // Run all aggregate queries in parallel
    const [
      totalsResult,
      errorCountResult,
      topModelsResult,
      topUsersResult,
      dailyVolumeResult,
    ] = await Promise.all([
      // Overall totals + avg latency
      db.execute<{ total_queries: string; unique_users: string; avg_latency: string }>(
        sql`
          SELECT
            COUNT(*)::text AS total_queries,
            COUNT(DISTINCT "userId")::text AS unique_users,
            ROUND(AVG("latencyMs"))::text AS avg_latency
          FROM "AuditLog"
        `,
      ),

      // Error rate: records where metadata->>'error' IS NOT NULL
      db.execute<{ error_count: string }>(
        sql`
          SELECT COUNT(*)::text AS error_count
          FROM "AuditLog"
          WHERE "metadata"->>'error' IS NOT NULL
        `,
      ),

      // Top 10 models by usage
      db.execute<{ model: string; query_count: string }>(
        sql`
          SELECT "modelName" AS model, COUNT(*)::text AS query_count
          FROM "AuditLog"
          GROUP BY "modelName"
          ORDER BY COUNT(*) DESC
          LIMIT 10
        `,
      ),

      // Top 10 users by query count
      db.execute<{ user_id: string; username: string; query_count: string }>(
        sql`
          SELECT
            al."userId"::text AS user_id,
            COALESCE(u."username", al."userId"::text) AS username,
            COUNT(*)::text AS query_count
          FROM "AuditLog" al
          LEFT JOIN "User" u ON u.id = al."userId"
          GROUP BY al."userId", u."username"
          ORDER BY COUNT(*) DESC
          LIMIT 10
        `,
      ),

      // Queries per day for the last 30 days
      db.execute<{ day: string; query_count: string }>(
        sql`
          SELECT
            DATE("createdAt" AT TIME ZONE 'UTC')::text AS day,
            COUNT(*)::text AS query_count
          FROM "AuditLog"
          WHERE "createdAt" >= ${thirtyDaysAgo}
          GROUP BY DATE("createdAt" AT TIME ZONE 'UTC')
          ORDER BY day ASC
        `,
      ),
    ]);

    const totals = totalsResult.rows[0] ?? { total_queries: "0", unique_users: "0", avg_latency: "0" };
    const errorCount = parseInt(errorCountResult.rows[0]?.error_count ?? "0", 10);
    const totalQueries = parseInt(totals.total_queries, 10);
    const errorRate = totalQueries > 0 ? errorCount / totalQueries : 0;

    return {
      totalQueries,
      uniqueUsers: parseInt(totals.unique_users, 10),
      avgLatencyMs: parseFloat(totals.avg_latency ?? "0"),
      errorRate: Math.round(errorRate * 10000) / 10000, // 4 decimal places
      topModels: topModelsResult.rows.map((r) => ({
        model: r.model,
        queryCount: parseInt(r.query_count, 10),
      })),
      topUsers: topUsersResult.rows.map((r) => ({
        userId: parseInt(r.user_id, 10),
        username: r.username,
        queryCount: parseInt(r.query_count, 10),
      })),
      queriesPerDay: dailyVolumeResult.rows.map((r) => ({
        day: r.day,
        queryCount: parseInt(r.query_count, 10),
      })),
    };
  });

  // ─── GET /export — CSV export with date range filter ──────────────────────

  fastify.get("/export", async (request, reply) => {
    const { dateFrom, dateTo, limit: rawLimit } = request.query as {
      dateFrom?: string;
      dateTo?: string;
      limit?: string;
    };

    const limitNum = Math.min(safeInt(rawLimit, 10_000), 50_000);

    const conditions = [];
    const fromDate = safeDate(dateFrom);
    const toDate = safeDate(dateTo);
    if (fromDate) conditions.push(gte(auditLogs.createdAt, fromDate));
    if (toDate) conditions.push(lte(auditLogs.createdAt, toDate));

    const rows = await db
      .select({
        id: auditLogs.id,
        userId: auditLogs.userId,
        conversationId: auditLogs.conversationId,
        model: auditLogs.modelName,
        prompt: auditLogs.prompt,
        response: auditLogs.response,
        tokensIn: auditLogs.tokensIn,
        tokensOut: auditLogs.tokensOut,
        latencyMs: auditLogs.latencyMs,
        hasError: sql<boolean>`(${auditLogs.metadata}->>'error') IS NOT NULL`,
        createdAt: auditLogs.createdAt,
      })
      .from(auditLogs)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(auditLogs.createdAt))
      .limit(limitNum);

    const CSV_HEADERS = [
      "id",
      "userId",
      "conversationId",
      "model",
      "prompt",
      "response",
      "tokensIn",
      "tokensOut",
      "tokensTotal",
      "latencyMs",
      "hasError",
      "createdAt",
    ];

    const csvLines: string[] = [CSV_HEADERS.join(",")];
    for (const row of rows) {
      csvLines.push(
        [
          csvEscape(row.id),
          csvEscape(row.userId),
          csvEscape(row.conversationId),
          csvEscape(row.model),
          csvEscape(row.prompt),
          csvEscape(row.response),
          csvEscape(row.tokensIn),
          csvEscape(row.tokensOut),
          csvEscape((row.tokensIn ?? 0) + (row.tokensOut ?? 0)),
          csvEscape(row.latencyMs),
          csvEscape(row.hasError),
          csvEscape(row.createdAt?.toISOString()),
        ].join(","),
      );
    }

    const filename = `audit-log-${new Date().toISOString().split("T")[0]}.csv`;

    reply
      .header("Content-Type", "text/csv; charset=utf-8")
      .header("Content-Disposition", `attachment; filename="${filename}"`)
      .send(csvLines.join("\n"));
  });

  // ─── DELETE /queries/:id — delete audit record ────────────────────────────

  fastify.delete("/queries/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const idNum = safeInt(id, NaN);
    if (Number.isNaN(idNum)) throw new AppError(400, "id must be numeric");

    const deleted = await db
      .delete(auditLogs)
      .where(eq(auditLogs.id, idNum))
      .returning({ id: auditLogs.id });

    if (deleted.length === 0) throw new AppError(404, "Audit record not found");

    reply.code(204);
  });
};

export default auditDashboardPlugin;
