/**
 * Hook Extension Routes — CRUD, execution, testing, and management of
 * user-defined hook extensions (Phase 3.11).
 *
 * Endpoints:
 *   POST   /api/hook-extensions             — Create a hook extension
 *   GET    /api/hook-extensions             — List hooks (optional ?hookPoint filter)
 *   GET    /api/hook-extensions/built-in    — List built-in hook templates
 *   PUT    /api/hook-extensions/:id         — Update a hook
 *   DELETE /api/hook-extensions/:id         — Delete a hook
 *   PATCH  /api/hook-extensions/:id/toggle  — Toggle hook active/inactive
 *   POST   /api/hook-extensions/:id/test    — Test hook with sample input
 *   GET    /api/hook-extensions/:id/logs    — Get execution logs
 *   PUT    /api/hook-extensions/reorder     — Reorder hooks for a hook point
 *   POST   /api/hook-extensions/validate    — Validate hook code syntax
 */

import type { FastifyPluginAsync } from "fastify";
import { fastifyRequireAuth } from "../middleware/fastifyAuth.js";
import { HOOK_POINTS, type HookPoint } from "../db/schema/hookExtensions.js";
import {
  createHook,
  getHooks,
  updateHook,
  deleteHook,
  toggleHook,
  executeHook,
  getHookLogs,
  getBuiltInHooks,
  validateHookCode,
  reorderHooks,
  type CreateHookInput,
  type UpdateHookInput,
} from "../services/hookExtensions.service.js";

const VALID_HOOK_POINTS = new Set<string>(HOOK_POINTS);

export const hookExtensionsPlugin: FastifyPluginAsync = async (fastify) => {
  // All routes require authentication
  fastify.addHook("onRequest", fastifyRequireAuth);

  // ─── List built-in templates ───────────────────────────────────────────────
  // Registered BEFORE the :id routes to avoid route collision

  fastify.get("/built-in", { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async () => {
    return { templates: getBuiltInHooks() };
  });

  // ─── Validate hook code ────────────────────────────────────────────────────

  fastify.post("/validate", {
    config: { rateLimit: { max: 30, timeWindow: "1 minute" } },
  }, async (request, reply) => {
    const body = request.body as { code?: string; language?: string };
    if (!body.code || typeof body.code !== "string") {
      reply.code(400);
      return { error: "code is required" };
    }
    const language = body.language ?? "javascript";
    const result = validateHookCode(body.code, language);
    return result;
  });

  // ─── Reorder hooks ────────────────────────────────────────────────────────

  fastify.put("/reorder", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (request, reply) => {
    const body = request.body as { hookPoint?: string; orderedIds?: number[] };
    if (!body.hookPoint || !VALID_HOOK_POINTS.has(body.hookPoint)) {
      reply.code(400);
      return { error: `hookPoint must be one of: ${HOOK_POINTS.join(", ")}` };
    }
    if (!Array.isArray(body.orderedIds) || body.orderedIds.length === 0) {
      reply.code(400);
      return { error: "orderedIds must be a non-empty array of hook IDs" };
    }

    const hooks = await reorderHooks(
      request.userId!,
      body.hookPoint as HookPoint,
      body.orderedIds,
    );
    return { hooks };
  });

  // ─── Create hook ──────────────────────────────────────────────────────────

  fastify.post("/", { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } }, async (request, reply) => {
    const body = request.body as Record<string, unknown>;
    if (!body.name || typeof body.name !== "string") {
      reply.code(400);
      return { error: "name is required" };
    }
    if (!body.hookPoint || !VALID_HOOK_POINTS.has(body.hookPoint as string)) {
      reply.code(400);
      return { error: `hookPoint must be one of: ${HOOK_POINTS.join(", ")}` };
    }
    if (!body.code || typeof body.code !== "string") {
      reply.code(400);
      return { error: "code is required" };
    }

    // Validate code before saving
    const validation = validateHookCode(body.code as string, (body.language as string) ?? "javascript");
    if (!validation.valid) {
      reply.code(400);
      return { error: "Invalid hook code", details: validation.errors };
    }

    const input: CreateHookInput = {
      name: body.name as string,
      description: (body.description as string) ?? undefined,
      hookPoint: body.hookPoint as HookPoint,
      executionOrder: body.executionOrder !== null ? Number(body.executionOrder) : undefined,
      code: body.code as string,
      language: (body.language as "javascript" | "typescript") ?? "javascript",
      isActive: body.isActive !== false,
      config: (body.config as Record<string, unknown>) ?? undefined,
      timeout: body.timeout !== null ? Number(body.timeout) : undefined,
    };

    const hook = await createHook(request.userId!, input);
    reply.code(201);
    return hook;
  });

  // ─── List hooks ───────────────────────────────────────────────────────────

  fastify.get("/", { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (request) => {
    const query = request.query as { hookPoint?: string };
    let hookPoint: HookPoint | undefined;
    if (query.hookPoint) {
      if (!VALID_HOOK_POINTS.has(query.hookPoint)) {
        return { hooks: [] };
      }
      hookPoint = query.hookPoint as HookPoint;
    }

    const hooks = await getHooks(request.userId!, hookPoint);
    return { hooks };
  });

  // ─── Update hook ──────────────────────────────────────────────────────────

  fastify.put("/:id", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as Record<string, unknown>;

    // Validate hookPoint if provided
    if (body.hookPoint && !VALID_HOOK_POINTS.has(body.hookPoint as string)) {
      reply.code(400);
      return { error: `hookPoint must be one of: ${HOOK_POINTS.join(", ")}` };
    }

    // Validate code if provided
    if (body.code && typeof body.code === "string") {
      const validation = validateHookCode(body.code, (body.language as string) ?? "javascript");
      if (!validation.valid) {
        reply.code(400);
        return { error: "Invalid hook code", details: validation.errors };
      }
    }

    const input: UpdateHookInput = {};
    if (body.name !== null) input.name = body.name as string;
    if (body.description !== undefined) input.description = body.description as string;
    if (body.hookPoint !== null) input.hookPoint = body.hookPoint as HookPoint;
    if (body.executionOrder !== null) input.executionOrder = Number(body.executionOrder);
    if (body.code !== null) input.code = body.code as string;
    if (body.language !== null) input.language = body.language as "javascript" | "typescript";
    if (body.isActive !== null) input.isActive = Boolean(body.isActive);
    if (body.config !== undefined) input.config = body.config as Record<string, unknown>;
    if (body.timeout !== null) input.timeout = Number(body.timeout);

    const hook = await updateHook(Number(id), request.userId!, input);
    if (!hook) {
      reply.code(404);
      return { error: "Hook not found" };
    }
    return hook;
  });

  // ─── Delete hook ──────────────────────────────────────────────────────────

  fastify.delete("/:id", { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const deleted = await deleteHook(Number(id), request.userId!);
    if (!deleted) {
      reply.code(404);
      return { error: "Hook not found" };
    }
    reply.code(204);
  });

  // ─── Toggle hook ──────────────────────────────────────────────────────────

  fastify.patch("/:id/toggle", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as { isActive?: boolean };
    if (body.isActive === null || body.isActive === undefined) {
      reply.code(400);
      return { error: "isActive is required" };
    }

    const hook = await toggleHook(Number(id), request.userId!, body.isActive);
    if (!hook) {
      reply.code(404);
      return { error: "Hook not found" };
    }
    return hook;
  });

  // ─── Test hook ────────────────────────────────────────────────────────────

  fastify.post("/:id/test", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as { content?: string; config?: Record<string, unknown> };

    if (!body.content || typeof body.content !== "string") {
      reply.code(400);
      return { error: "content is required for testing" };
    }

    const startedAt = Date.now();
    try {
      const result = await executeHook(Number(id), {
        content: body.content,
        config: body.config ?? {},
      });
      return {
        ok: true,
        result,
        durationMs: Date.now() - startedAt,
      };
    } catch (err) {
      reply.code(422);
      return {
        ok: false,
        error: (err as Error).message,
        durationMs: Date.now() - startedAt,
      };
    }
  });

  // ─── Get execution logs ───────────────────────────────────────────────────

  fastify.get("/:id/logs", { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (request) => {
    const { id } = request.params as { id: string };
    const query = request.query as { limit?: string; offset?: string };

    const { logs, total } = await getHookLogs(Number(id), {
      limit: query.limit ? Number(query.limit) : undefined,
      offset: query.offset ? Number(query.offset) : undefined,
    });

    return { logs, total };
  });
};

export default hookExtensionsPlugin;
