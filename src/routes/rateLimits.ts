/**
 * Token Rate Limit Routes — admin endpoints for managing rate limit tiers and assignments.
 *
 * Endpoints:
 *   GET    /tiers          — List all rate limit tiers
 *   POST   /tiers          — Create a new tier (admin)
 *   PUT    /tiers/:id      — Update a tier (admin)
 *   DELETE /tiers/:id      — Delete a tier (admin)
 *   GET    /status         — Get current user's rate limit status
 *   PUT    /users/:userId  — Assign tier to user (admin)
 *   DELETE /users/:userId  — Remove user tier override (admin)
 *   PUT    /groups/:groupId — Assign tier to group (admin)
 *   DELETE /groups/:groupId — Remove group tier override (admin)
 */

import type { FastifyPluginAsync } from "fastify";
import { fastifyRequireAuth, fastifyRequireAdmin } from "../middleware/fastifyAuth.js";
import {
  listTiers,
  createTier,
  updateTier,
  deleteTier,
  setUserTier,
  removeUserTier,
  setGroupTier,
  removeGroupTier,
  checkRateLimit,
} from "../services/rateLimit.service.js";

const rateLimitPlugin: FastifyPluginAsync = async (fastify) => {
  // ─── Public: check own status ───────────────────────────────────────────────
  fastify.get("/status", { preHandler: fastifyRequireAuth }, async (request) => {
    return checkRateLimit(request.userId!);
  });

  // ─── Tier CRUD (admin only) ─────────────────────────────────────────────────

  fastify.get("/tiers", { preHandler: fastifyRequireAuth }, async () => {
    return { tiers: await listTiers() };
  });

  fastify.post("/tiers", { preHandler: fastifyRequireAdmin }, async (request, reply) => {
    const body = request.body as Record<string, unknown>;
    if (!body.name || typeof body.name !== "string") {
      reply.code(400);
      return { error: "name is required" };
    }
    const tier = await createTier({
      name: body.name,
      requestsPerMinute: Number(body.requestsPerMinute) || 60,
      requestsPerHour: Number(body.requestsPerHour) || 1000,
      requestsPerDay: Number(body.requestsPerDay) || 10000,
      tokensPerMinute: Number(body.tokensPerMinute) || 100000,
      tokensPerDay: Number(body.tokensPerDay) || 1000000,
      maxConcurrent: Number(body.maxConcurrent) || 5,
    });
    reply.code(201);
    return tier;
  });

  fastify.put("/tiers/:id", { preHandler: fastifyRequireAdmin }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as Record<string, unknown>;
    const updated = await updateTier(Number(id), body);
    if (!updated) {
      reply.code(404);
      return { error: "Tier not found" };
    }
    return updated;
  });

  fastify.delete("/tiers/:id", { preHandler: fastifyRequireAdmin }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const deleted = await deleteTier(Number(id));
    if (!deleted) {
      reply.code(404);
      return { error: "Tier not found" };
    }
    reply.code(204);
  });

  // ─── User/Group Assignments (admin only) ────────────────────────────────────

  fastify.put("/users/:userId", { preHandler: fastifyRequireAdmin }, async (request, reply) => {
    const { userId } = request.params as { userId: string };
    const body = request.body as { tierId?: number };
    if (!body.tierId) {
      reply.code(400);
      return { error: "tierId is required" };
    }
    await setUserTier(Number(userId), body.tierId);
    return { ok: true };
  });

  fastify.delete("/users/:userId", { preHandler: fastifyRequireAdmin }, async (request, reply) => {
    const { userId } = request.params as { userId: string };
    await removeUserTier(Number(userId));
    reply.code(204);
  });

  fastify.put("/groups/:groupId", { preHandler: fastifyRequireAdmin }, async (request, reply) => {
    const { groupId } = request.params as { groupId: string };
    const body = request.body as { tierId?: number };
    if (!body.tierId) {
      reply.code(400);
      return { error: "tierId is required" };
    }
    await setGroupTier(Number(groupId), body.tierId);
    return { ok: true };
  });

  fastify.delete("/groups/:groupId", { preHandler: fastifyRequireAdmin }, async (request, reply) => {
    const { groupId } = request.params as { groupId: string };
    await removeGroupTier(Number(groupId));
    reply.code(204);
  });
};

export default rateLimitPlugin;
