/**
 * Hook Admin Routes — introspect and test the hook extension system.
 *
 * Endpoints:
 *   GET  /api/hooks       — list all registered hooks (admin only)
 *   POST /api/hooks/test  — fire a test hook with mock context (admin only)
 */

import type { FastifyPluginAsync } from "fastify";
import { fastifyRequireAdmin } from "../middleware/fastifyAuth.js";
import { hooks } from "../lib/hooks/hookRegistry.js";
import type { HookStage, HookContext } from "../lib/hooks/hookRegistry.js";

const VALID_STAGES = new Set<HookStage>([
  "pre:query",
  "post:retrieval",
  "pre:llm",
  "post:llm",
  "pre:response",
  "on:error",
]);

const hooksPlugin: FastifyPluginAsync = async (fastify) => {
  fastify.addHook("onRequest", fastifyRequireAdmin);

  /**
   * GET /api/hooks
   * Returns a summary of all registered hooks grouped by stage.
   */
  fastify.get("/", async (_request, _reply) => {
    const registered = hooks.list();
    return {
      hooks: registered,
      totalStages: registered.length,
      totalHooks: registered.reduce((sum, s) => sum + s.count, 0),
    };
  });

  /**
   * POST /api/hooks/test
   * Fires a test hook pipeline with the provided mock context.
   * Useful for verifying hook behaviour without a real pipeline request.
   *
   * Body:
   *   stage    — HookStage to fire (required)
   *   context  — Partial HookContext fields (optional)
   */
  fastify.post("/test", async (request, reply) => {
    const body = request.body as {
      stage?: string;
      context?: Partial<HookContext>;
    };

    if (!body.stage || typeof body.stage !== "string") {
      reply.code(400);
      return { error: "stage is required" };
    }

    if (!VALID_STAGES.has(body.stage as HookStage)) {
      reply.code(400);
      return {
        error: `Invalid stage '${body.stage}'. Valid stages: ${[...VALID_STAGES].join(", ")}`,
      };
    }

    const stage = body.stage as HookStage;
    const inputCtx: HookContext = {
      stage,
      userId: request.userId,
      query: "test query",
      documents: [],
      response: "test response",
      metadata: { test: true },
      ...body.context,
    };

    const startedAt = Date.now();
    try {
      const outputCtx = await hooks.run(stage, inputCtx);
      return {
        stage,
        input: inputCtx,
        output: outputCtx,
        durationMs: Date.now() - startedAt,
        ok: true,
      };
    } catch (err) {
      reply.code(422);
      return {
        stage,
        input: inputCtx,
        error: (err as Error).message,
        durationMs: Date.now() - startedAt,
        ok: false,
      };
    }
  });
};

export default hooksPlugin;
