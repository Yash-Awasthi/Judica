/**
 * Feature Flag Routes
 *
 * Endpoints:
 *   GET    /                    — Evaluate all flags for current user
 *   GET    /evaluate/:key       — Evaluate single flag
 *   GET    /admin/flags         — List all flag definitions (admin)
 *   POST   /admin/flags         — Create flag (admin)
 *   PUT    /admin/flags/:id     — Update flag (admin)
 *   DELETE /admin/flags/:id     — Delete flag (admin)
 *   PUT    /admin/flags/:id/users/:userId     — Set user override (admin)
 *   DELETE /admin/flags/:id/users/:userId     — Remove user override (admin)
 *   PUT    /admin/flags/:id/groups/:groupId   — Set group override (admin)
 *   DELETE /admin/flags/:id/groups/:groupId   — Remove group override (admin)
 */

import type { FastifyPluginAsync } from "fastify";
import { fastifyRequireAuth, fastifyRequireAdmin } from "../middleware/fastifyAuth.js";
import {
  evaluateFlag,
  evaluateAllFlags,
  listFlags,
  createFlag,
  updateFlag,
  deleteFlag,
  setUserOverride,
  removeUserOverride,
  setGroupOverride,
  removeGroupOverride,
} from "../services/featureFlag.service.js";

const featureFlagPlugin: FastifyPluginAsync = async (fastify) => {
  // ─── User-facing: evaluate flags ────────────────────────────────────────────

  fastify.get("/", { preHandler: fastifyRequireAuth }, async (request) => {
    return evaluateAllFlags(request.userId);
  });

  fastify.get("/evaluate/:key", { preHandler: fastifyRequireAuth }, async (request) => {
    const { key } = request.params as { key: string };
    return evaluateFlag(key, request.userId);
  });

  // ─── Admin: CRUD ────────────────────────────────────────────────────────────

  fastify.get("/admin/flags", { preHandler: fastifyRequireAdmin }, async () => {
    return { flags: await listFlags() };
  });

  fastify.post("/admin/flags", { preHandler: fastifyRequireAdmin }, async (request, reply) => {
    const body = request.body as Record<string, unknown>;
    if (!body.key || typeof body.key !== "string") {
      reply.code(400);
      return { error: "key is required" };
    }
    if (!body.name || typeof body.name !== "string") {
      reply.code(400);
      return { error: "name is required" };
    }
    const flag = await createFlag({
      key: body.key,
      name: body.name,
      description: (body.description as string) ?? null,
      enabled: body.enabled === true,
      rolloutPercent: Number(body.rolloutPercent) || 100,
      flagType: (body.flagType as string) ?? "boolean",
      variants: (body.variants as Record<string, number>) ?? null,
      environment: (body.environment as string) ?? "all",
    });
    reply.code(201);
    return flag;
  });

  fastify.put("/admin/flags/:id", { preHandler: fastifyRequireAdmin }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as Record<string, unknown>;
    const updated = await updateFlag(Number(id), body);
    if (!updated) {
      reply.code(404);
      return { error: "Flag not found" };
    }
    return updated;
  });

  fastify.delete("/admin/flags/:id", { preHandler: fastifyRequireAdmin }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const deleted = await deleteFlag(Number(id));
    if (!deleted) {
      reply.code(404);
      return { error: "Flag not found" };
    }
    reply.code(204);
  });

  // ─── Admin: Overrides ───────────────────────────────────────────────────────

  fastify.put("/admin/flags/:id/users/:userId", { preHandler: fastifyRequireAdmin }, async (request) => {
    const { id, userId } = request.params as { id: string; userId: string };
    const body = request.body as { enabled: boolean; variant?: string };
    await setUserOverride(Number(id), Number(userId), body.enabled, body.variant);
    return { ok: true };
  });

  fastify.delete("/admin/flags/:id/users/:userId", { preHandler: fastifyRequireAdmin }, async (request, reply) => {
    const { id, userId } = request.params as { id: string; userId: string };
    await removeUserOverride(Number(id), Number(userId));
    reply.code(204);
  });

  fastify.put("/admin/flags/:id/groups/:groupId", { preHandler: fastifyRequireAdmin }, async (request) => {
    const { id, groupId } = request.params as { id: string; groupId: string };
    const body = request.body as { enabled: boolean };
    await setGroupOverride(Number(id), Number(groupId), body.enabled);
    return { ok: true };
  });

  fastify.delete("/admin/flags/:id/groups/:groupId", { preHandler: fastifyRequireAdmin }, async (request, reply) => {
    const { id, groupId } = request.params as { id: string; groupId: string };
    await removeGroupOverride(Number(id), Number(groupId));
    reply.code(204);
  });
};

export default featureFlagPlugin;
