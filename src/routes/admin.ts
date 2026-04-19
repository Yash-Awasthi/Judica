import { FastifyPluginAsync } from "fastify";
import fastifyRateLimit from "@fastify/rate-limit";
import { db } from "../lib/drizzle.js";
import { users } from "../db/schema/users.js";
import { customProviders } from "../db/schema/council.js";
import { auditLogs } from "../db/schema/conversations.js";
import { desc, sql, gte, lte } from "drizzle-orm";
import { fastifyRequireAdmin } from "../middleware/fastifyAuth.js";
import { AdminService } from "../services/adminService.js";
import { AppError } from "../middleware/errorHandler.js";
import redis from "../lib/redis.js";

const adminPlugin: FastifyPluginAsync = async (fastify) => {
  await fastify.register(fastifyRateLimit, { max: 60, timeWindow: "1 minute" });
  // All routes in this plugin require admin role
  fastify.addHook("preHandler", fastifyRequireAdmin);

  // ─── USER MANAGEMENT ───────────────────────────────────────────────────────

  // GET /users — search and list users
  fastify.get("/users", async (request, _reply) => {
    const { 
      search, 
      limit = 20, 
      offset = 0, 
      sortBy = "createdAt", 
      sortOrder = "desc" 
    } = request.query as any;
    
    return AdminService.getUsers({
      search,
      limit: parseInt(limit),
      offset: parseInt(offset),
      sortBy,
      sortOrder
    });
  });

  // GET /users/:id — user detail for modal
  fastify.get("/users/:id", async (request, _reply) => {
    const { id } = request.params as any;
    const userId = parseInt(id);
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
    const { role } = request.body as any;
    const { id } = request.params as any;
    
    const validRoles = ["admin", "member", "viewer"];
    if (!validRoles.includes(role)) {
      throw new AppError(400, `Role must be: ${validRoles.join(", ")}`);
    }

    await AdminService.updateUserRole(parseInt(id), role, request.userId!);
    return { success: true, role };
  });

  // POST /users/:id/suspend — suspend user and revoke sessions
  fastify.post("/users/:id/suspend", async (request, _reply) => {
    const { id } = request.params as any;
    const userId = parseInt(id);

    await AdminService.setUserStatus(userId, false, request.userId!);

    // Revoke all sessions for this user in Redis
    await redis.set(`user:status:${userId}`, "suspended", { EX: 86400 * 30 });
    
    return { success: true };
  });

  // POST /users/:id/activate — reactivate user
  fastify.post("/users/:id/activate", async (request, _reply) => {
    const { id } = request.params as any;
    const userId = parseInt(id);

    await AdminService.setUserStatus(userId, true, request.userId!);
    await redis.del(`user:status:${userId}`);

    return { success: true };
  });

  // DELETE /users/:id — hard delete user
  fastify.delete("/users/:id", async (request, _reply) => {
    const { id } = request.params as any;
    await AdminService.deleteUser(parseInt(id), request.userId!);
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
    const { name, description } = request.body as any;
    if (!name) throw new AppError(400, "Group name is required");
    
    const group = await AdminService.createGroup(name, description, request.userId!);
    reply.code(201);
    return { success: true, group };
  });

  // POST /groups/:id/members — add member to group
  fastify.post("/groups/:id/members", async (request, _reply) => {
    const { id } = request.params as any;
    const { userId } = request.body as any;
    
    if (!userId) throw new AppError(400, "User ID is required");
    
    await AdminService.addMemberToGroup(parseInt(id), parseInt(userId), request.userId!);
    return { success: true };
  });

  // DELETE /groups/:id/members/:userId — remove member from group
  fastify.delete("/groups/:id/members/:userId", async (request, _reply) => {
    const { id, userId } = request.params as any;
    
    await AdminService.removeMemberFromGroup(parseInt(id), parseInt(userId), request.userId!);
    return { success: true };
  });

  // ─── SYSTEM CONFIGURATION ──────────────────────────────────────────────────

  // GET /config — get all system settings
  fastify.get("/config", async (_request, _reply) => {
    return AdminService.getConfig();
  });

  // PATCH /config — update system settings
  fastify.patch("/config", async (request, _reply) => {
    const body = request.body as Record<string, any>;
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
    const { id } = request.params as any;
    await AdminService.setProviderDefault(parseInt(id), request.userId!);
    return { success: true };
  });

  // ─── ANALYTICS ─────────────────────────────────────────────────────────────
  
  // GET /analytics/metrics — system-wide totals
  fastify.get("/analytics/metrics", async (_request, _reply) => {
    return AdminService.getSystemStats();
  });

  // GET /analytics/daily-volume — time-series usage data
  fastify.get("/analytics/daily-volume", async (request, _reply) => {
    const { days = 30 } = request.query as any;
    const data = await AdminService.getUsageAnalytics(parseInt(days));
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
    const { actionType, limit, offset, startDate, endDate } = request.query as any;
    const logs = await AdminService.getAuditLogs({
      actionType,
      limit: limit ? parseInt(limit) : 50,
      offset: offset ? parseInt(offset) : 0,
      startDate: startDate ? new Date(startDate) : undefined,
      endDate: endDate ? new Date(endDate) : undefined,
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
    const { old_key, new_key } = request.body as any;

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
  fastify.get("/audit/export", async (request, reply) => {
    const { from, to, limit: rawLimit } = request.query as {
      from?: string;
      to?: string;
      limit?: string;
    };

    const limit = Math.min(parseInt(rawLimit || "10000", 10), 50_000);
    const conditions = [];
    if (from) conditions.push(gte(auditLogs.createdAt, new Date(from)));
    if (to) conditions.push(lte(auditLogs.createdAt, new Date(to)));

    const rows = await db
      .select()
      .from(auditLogs)
      .where(conditions.length > 0 ? sql`${conditions.reduce((acc, c) => sql`${acc} AND ${c}`)}` : undefined)
      .orderBy(desc(auditLogs.createdAt))
      .limit(limit);

    const jsonl = rows.map((r) => JSON.stringify(r)).join("\n");
    const filename = `audit-export-${new Date().toISOString().split("T")[0]}.jsonl`;

    reply
      .header("Content-Type", "application/x-ndjson")
      .header("Content-Disposition", `attachment; filename="${filename}"`)
      .send(jsonl);
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

    await AdminService.updateUserRole(parseInt(id), role, request.userId!);
    return { success: true, id, role };
  });
};

export default adminPlugin;
