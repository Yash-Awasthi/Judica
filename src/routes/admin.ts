import type { FastifyPluginAsync } from "fastify";
import fastifyRateLimit from "@fastify/rate-limit";
import { db } from "../lib/drizzle.js";
import { users } from "../db/schema/users.js";
import { customProviders } from "../db/schema/council.js";
import { auditLogs } from "../db/schema/conversations.js";
import { desc, sql, gte, lte } from "drizzle-orm";
import { fastifyRequireAdmin } from "../middleware/fastifyAuth.js";
import { AdminService } from "../services/admin.service.js";
import { AppError } from "../middleware/errorHandler.js";
import redis from "../lib/redis.js";

/** Parse a value to an integer, returning `fallback` when the result is NaN. */
function safeInt(value: string | number | undefined, fallback: number): number {
  const n = typeof value === 'number' ? value : parseInt(String(value), 10);
  return Number.isNaN(n) ? fallback : n;
}

const adminPlugin: FastifyPluginAsync = async (fastify) => {
  await fastify.register(fastifyRateLimit, { max: 60, timeWindow: "1 minute" });
  // All routes in this plugin require admin role
  fastify.addHook("preHandler", fastifyRequireAdmin);

  // P3-22: Helper to parse and validate numeric IDs from route params.
  // Returns 400 on non-numeric or NaN values instead of silently passing NaN.
  function parseId(raw: string): number {
    const id = parseInt(raw, 10);
    if (Number.isNaN(id)) throw new AppError(400, "Invalid ID: must be a numeric value");
    return id;
  }

  function safeDate(value: string | undefined): Date | undefined {
    if (!value) return undefined;
    const d = new Date(value);
    if (isNaN(d.getTime())) throw new AppError(400, `Invalid date: ${value}`);
    return d;
  }

  // ─── USER MANAGEMENT ───────────────────────────────────────────────────────

  // GET /users — search and list users
  fastify.get("/users", async (request, _reply) => {
    const { 
      search, 
      limit = 20, 
      offset = 0, 
      sortBy = "createdAt", 
      sortOrder = "desc" 
    } = request.query as { search?: string; limit?: string | number; offset?: string | number; sortBy?: string; sortOrder?: string };
    
    // P3-23: Whitelist allowed sort columns to prevent SQL injection
    const allowedSortBy = ["email", "username", "createdAt"] as const;
    const safeSortBy = allowedSortBy.includes(sortBy as typeof allowedSortBy[number])
      ? (sortBy as "email" | "username" | "createdAt")
      : "createdAt";
    const safeSortOrder = sortOrder === "asc" ? "asc" : "desc";

    return AdminService.getUsers({
      search,
      limit: safeInt(limit, 20),
      offset: safeInt(offset, 0),
      sortBy: safeSortBy,
      sortOrder: safeSortOrder
    });
  });

  // GET /users/:id — user detail for modal
  fastify.get("/users/:id", async (request, _reply) => {
    const { id } = request.params as { id: string };
    const userId = parseId(id);
    const detail = await AdminService.getUserDetail(userId);
    if (!detail) throw new AppError(404, "User not found");

    const apiKeys = await AdminService.getUserApiKeys(userId);
    
    return { 
      user: {
        ...detail,
        apiKeys
      }
    };
  });

  // PUT /users/:id/role — change user role
  fastify.put("/users/:id/role", async (request, _reply) => {
    const { role } = request.body as { role: string };
    const { id } = request.params as { id: string };

    // P1-16: Unified role hierarchy across all endpoints
    const validRoles = ["owner", "admin", "member", "viewer"];
    if (!validRoles.includes(role)) {
      throw new AppError(400, `Role must be: ${validRoles.join(", ")}`);
    }

    // P1-17: Prevent demotion that would leave zero admins
    const currentUser = await AdminService.getUserDetail(parseId(id));
    if (currentUser && (currentUser.role === "admin" || currentUser.role === "owner") && role !== "admin" && role !== "owner") {
      const { users: allUsers } = await AdminService.getUsers({ limit: 1000, offset: 0 });
      const adminCount = allUsers.filter((u: { role: string; id: number }) =>
        (u.role === "admin" || u.role === "owner") && u.id !== parseId(id)
      ).length;
      if (adminCount === 0) {
        throw new AppError(400, "Cannot demote: at least one admin/owner must remain");
      }
    }

    await AdminService.updateUserRole(parseId(id), role, request.userId!);
    return { success: true, role };
  });

  // POST /users/:id/suspend — suspend user and revoke sessions
  fastify.post("/users/:id/suspend", async (request, _reply) => {
    const { id } = request.params as { id: string };
    const userId = parseId(id);

    await AdminService.setUserStatus(userId, false, request.userId!);

    // P0-13: Suspension is permanent until admin clears it (no TTL)
    await redis.set(`user:status:${userId}`, "suspended");
    
    return { success: true };
  });

  // POST /users/:id/activate — reactivate user
  fastify.post("/users/:id/activate", async (request, _reply) => {
    const { id } = request.params as { id: string };
    const userId = parseId(id);

    await AdminService.setUserStatus(userId, true, request.userId!);
    await redis.del(`user:status:${userId}`);

    return { success: true };
  });

  // DELETE /users/:id — hard delete user
  fastify.delete("/users/:id", async (request, _reply) => {
    const { id } = request.params as { id: string };
    await AdminService.deleteUser(parseId(id), request.userId!);
    return { success: true };
  });

  // ─── GROUP MANAGEMENT ───────────────────────────────────────────────────────

  // GET /groups — list all groups with member counts
  fastify.get("/groups", async (_request, _reply) => {
    const groups = await AdminService.getGroups();
    return { groups };
  });

  // POST /groups — create new organizational group
  fastify.post("/groups", async (request, reply) => {
    const { name, description } = request.body as { name?: string; description?: string };
    if (!name) throw new AppError(400, "Group name is required");
    
    const group = await AdminService.createGroup(name, description, request.userId!);
    reply.code(201);
    return { success: true, group };
  });

  // POST /groups/:id/members — add member to group
  fastify.post("/groups/:id/members", async (request, _reply) => {
    const { id } = request.params as { id: string };
    const { userId } = request.body as { userId?: string };
    
    if (!userId) throw new AppError(400, "User ID is required");
    
    await AdminService.addMemberToGroup(parseId(id), parseId(userId), request.userId!);
    return { success: true };
  });

  // DELETE /groups/:id/members/:userId — remove member from group
  fastify.delete("/groups/:id/members/:userId", async (request, _reply) => {
    const { id, userId } = request.params as { id: string; userId: string };
    
    await AdminService.removeMemberFromGroup(parseId(id), parseId(userId), request.userId!);
    return { success: true };
  });

  // ─── SYSTEM CONFIGURATION ──────────────────────────────────────────────────

  // GET /config — get all system settings
  fastify.get("/config", async (_request, _reply) => {
    return AdminService.getConfig();
  });

  // PATCH /config — update system settings
  // P3-25: Whitelist allowed config keys to prevent arbitrary config injection.
  const ALLOWED_CONFIG_KEYS = new Set([
    "default_provider_id",
    "encryption_key_version",
    "max_tokens_per_request",
    "rate_limit_rpm",
    "enable_anonymous_access",
    "maintenance_mode",
    "system_announcement",
    "default_model",
    "max_conversation_history",
    "enable_vector_cache",
  ]);

  fastify.patch("/config", async (request, _reply) => {
    const body = request.body as Record<string, string>;
    const invalidKeys = Object.keys(body).filter(k => !ALLOWED_CONFIG_KEYS.has(k));
    if (invalidKeys.length > 0) {
      throw new AppError(400, `Invalid config keys: ${invalidKeys.join(", ")}. Allowed: ${[...ALLOWED_CONFIG_KEYS].join(", ")}`);
    }
    for (const [key, value] of Object.entries(body)) {
      await AdminService.updateConfig(key, value, request.userId!);
    }
    return { success: true };
  });

  // ─── PROVIDERS ─────────────────────────────────────────────────────────────

  // GET /providers — list API provider statuses
  fastify.get("/providers", async (_request, _reply) => {
    const providers = await db.select().from(customProviders);
    const config = await AdminService.getConfig();
    const defaultId = config.default_provider_id;

    return {
      providers: providers.map(p => ({
        id: p.id,
        name: p.name,
        baseUrl: p.baseUrl,
        status: "operational",
        models: p.models,
        isDefault: p.id.toString() === defaultId,
      }))
    };
  });

  // POST /providers/:id/default — set global default
  fastify.post("/providers/:id/default", async (request, _reply) => {
    const { id } = request.params as { id: string };
    await AdminService.setProviderDefault(parseId(id), request.userId!);
    return { success: true };
  });

  // ─── ANALYTICS ─────────────────────────────────────────────────────────────
  
  // GET /analytics/metrics — system-wide totals
  fastify.get("/analytics/metrics", async (_request, _reply) => {
    return AdminService.getSystemStats();
  });

  // GET /analytics/daily-volume — time-series usage data
  fastify.get("/analytics/daily-volume", async (request, _reply) => {
    const { days = 30 } = request.query as { days?: string | number };
    const data = await AdminService.getUsageAnalytics(safeInt(days, 30));
    return { data };
  });

  // GET /analytics/provider-breakdown — tokens per provider
  fastify.get("/analytics/provider-breakdown", async (_request, _reply) => {
    const providers = await AdminService.getProviderBreakdown();
    return { providers };
  });

  // ─── SECURITY & AUDIT ──────────────────────────────────────────────────────

  // GET /audit-log — view administrative actions
  fastify.get("/audit-log", async (request, _reply) => {
    const { actionType, limit, offset, startDate, endDate } = request.query as { actionType?: string; limit?: string; offset?: string; startDate?: string; endDate?: string };
    const logs = await AdminService.getAuditLogs({
      actionType,
      limit: safeInt(limit, 50),
      offset: safeInt(offset, 0),
      startDate: safeDate(startDate),
      endDate: safeDate(endDate),
    });
    return logs;
  });

  // GET /security/key-rotation — encryption status
  fastify.get("/security/key-rotation", async (_request, _reply) => {
    const configs = await AdminService.getConfig();
    return {
      currentRotation: new Date(), // Mock for UI
      nextRotation: new Date(Date.now() + 86400000 * 30),
      keyVersion: configs.encryption_key_version || 1,
      algorithm: "AES-256-GCM",
    };
  });

  // POST /security/key-rotation — trigger manual rotation
  fastify.post("/security/key-rotation", async (request, _reply) => {
    const { old_key, new_key } = request.body as { old_key?: string; new_key?: string };

    if (!old_key || !new_key) {
      throw new AppError(400, "old_key and new_key are required");
    }

    if (new_key.length < 32) {
      throw new AppError(400, "new_key must be at least 32 characters");
    }

    return AdminService.rotateEncryptionKeys({
      adminId: request.userId!,
      oldKey: old_key,
      newKey: new_key
    });
  });

  // GET /api/admin/audit/export — stream all audit logs as JSONL
  // P3-24: Stream rows in batches instead of buffering up to 50k in memory.
  fastify.get("/audit/export", async (request, reply) => {
    const { from, to, limit: rawLimit } = request.query as {
      from?: string;
      to?: string;
      limit?: string;
    };

    const limit = Math.min(safeInt(rawLimit, 10_000), 50_000);
    const conditions = [];
    const fromDate = safeDate(from);
    const toDate = safeDate(to);
    if (fromDate) conditions.push(gte(auditLogs.createdAt, fromDate));
    if (toDate) conditions.push(lte(auditLogs.createdAt, toDate));

    const filename = `audit-export-${new Date().toISOString().split("T")[0]}.jsonl`;

    reply.raw.writeHead(200, {
      "Content-Type": "application/x-ndjson",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Transfer-Encoding": "chunked",
    });

    const BATCH_SIZE = 500;
    let offset = 0;
    let fetched = 0;

    while (fetched < limit) {
      const batchLimit = Math.min(BATCH_SIZE, limit - fetched);
      const rows = await db
        .select()
        .from(auditLogs)
        .where(conditions.length > 0 ? sql`${conditions.reduce((acc, c) => sql`${acc} AND ${c}`)}` : undefined)
        .orderBy(desc(auditLogs.createdAt))
        .limit(batchLimit)
        .offset(offset);

      if (rows.length === 0) break;

      for (const row of rows) {
        reply.raw.write(JSON.stringify(row) + "\n");
      }

      fetched += rows.length;
      offset += rows.length;

      if (rows.length < batchLimit) break;
    }

    reply.raw.end();
  });

  /**
   * P4-33: SOC 2 structured audit log export.
   * GET /api/admin/audit/soc2?from=...&to=...
   * Returns JSON with metadata envelope for compliance tooling.
   */
  fastify.get("/audit/soc2", async (request, reply) => {
    const { from, to, limit: rawLimit } = request.query as {
      from?: string;
      to?: string;
      limit?: string;
    };

    const limit = Math.min(safeInt(rawLimit, 5_000), 10_000);
    const conditions = [];
    const fromDate = safeDate(from);
    const toDate = safeDate(to);
    if (fromDate) conditions.push(gte(auditLogs.createdAt, fromDate));
    if (toDate) conditions.push(lte(auditLogs.createdAt, toDate));

    const rows = await db
      .select()
      .from(auditLogs)
      .where(conditions.length > 0 ? sql`${conditions.reduce((a, b) => sql`${a} AND ${b}`)}` : sql`TRUE`)
      .orderBy(desc(auditLogs.createdAt))
      .limit(limit);

    return reply.send({
      export: {
        format: "soc2-audit-v1",
        generatedAt: new Date().toISOString(),
        generatedBy: request.userId,
        period: {
          from: from || null,
          to: to || null,
        },
        recordCount: rows.length,
      },
      events: rows.map((row) => ({
        id: row.id,
        timestamp: row.createdAt,
        actor: row.userId,
        action: (row as any).action ?? null,
        resource: (row as any).resource ?? null,
        details: (row as any).details ?? null,
        ip: (row as any).ip ?? null,
      })),
    });
  });

  // GET /api/admin/workspace/members — list all workspace members with roles
  fastify.get("/workspace/members", async (_request, _reply) => {
    const rows = await db
      .select({
        id: users.id,
        username: users.username,
        email: users.email,
        role: users.role,
        createdAt: users.createdAt,
      })
      .from(users)
      .orderBy(desc(users.createdAt))
      .limit(200);

    return { members: rows };
  });

  // PUT /api/admin/workspace/members/:id/role — update member role
  fastify.put("/workspace/members/:id/role", async (request, _reply) => {
    const { id } = request.params as { id: string };
    const { role } = request.body as { role: string };

    const validRoles = ["owner", "admin", "member", "viewer"];
    if (!validRoles.includes(role)) {
      throw new AppError(400, `Invalid role. Must be one of: ${validRoles.join(", ")}`);
    }

    await AdminService.updateUserRole(parseId(id), role, request.userId!);
    return { success: true, id, role };
  });

  // ─── P4-29: RELIABILITY SCORE ADMIN API ──────────────────────────────────────

  /**
   * GET /api/admin/reliability — list all model reliability scores.
   */
  fastify.get("/reliability", async (_request, _reply) => {
    const { getReliabilityScores: _getReliabilityScores } = await import("../services/reliability.service.js");
    const { modelReliability } = await import("../db/schema/traces.js");

    const allRows = await db.select().from(modelReliability);
    const scores = allRows.map((row) => ({
      model: row.model,
      avgConfidence: row.avgConfidence,
      totalResponses: row.totalResponses,
      agreedWith: row.agreedWith,
      contradicted: row.contradicted,
      toolErrors: row.toolErrors,
      updatedAt: row.updatedAt,
    }));

    return { models: scores };
  });

  /**
   * POST /api/admin/reliability/:model/reset — reset a model's reliability score.
   * Useful after model upgrades when historical data is no longer representative.
   */
  fastify.post("/reliability/:model/reset", async (request, _reply) => {
    const { model } = request.params as { model: string };
    const { modelReliability } = await import("../db/schema/traces.js");

    await db
      .update(modelReliability)
      .set({
        totalResponses: 0,
        agreedWith: 0,
        contradicted: 0,
        toolErrors: 0,
        avgConfidence: 0.5,
        updatedAt: new Date(),
      })
      .where(sql`${modelReliability.model} = ${model}`);

    return { success: true, model, message: "Reliability score reset to neutral (0.5)" };
  });
};

export default adminPlugin;
