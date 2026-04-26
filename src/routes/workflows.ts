import type { FastifyPluginAsync } from "fastify";
import { randomUUID } from "crypto";
import { db } from "../lib/drizzle.js";
import { workflows, workflowRuns } from "../db/schema/workflows.js";
import { eq, and, desc, count } from "drizzle-orm";
import { fastifyRequireAuth } from "../middleware/fastifyAuth.js";
import { AppError } from "../middleware/errorHandler.js";
import logger from "../lib/logger.js";
import type { ExecutionEvent, WorkflowDefinition } from "../workflow/types.js";
import type { WorkflowExecutor } from "../workflow/executor.js";
import { selfHealingConfig } from "../workflow/executor.js";

/**
 * Validate that a workflow definition has well-formed node and edge structures.
 * Throws AppError on malformed definitions to prevent runtime crashes.
 */
function validateWorkflowDefinition(definition: Record<string, unknown>): void {
  const { nodes, edges } = definition;

  if (!Array.isArray(nodes) || !Array.isArray(edges)) {
    throw new AppError(400, "Workflow definition must contain 'nodes' and 'edges' arrays", "WORKFLOW_INVALID");
  }

  const MAX_NODES = 500;
  const MAX_EDGES = 2000;
  if (nodes.length > MAX_NODES) {
    throw new AppError(400, `Workflow exceeds maximum of ${MAX_NODES} nodes`, "WORKFLOW_TOO_LARGE");
  }
  if (edges.length > MAX_EDGES) {
    throw new AppError(400, `Workflow exceeds maximum of ${MAX_EDGES} edges`, "WORKFLOW_TOO_LARGE");
  }

  if (nodes.length === 0) {
    throw new AppError(400, "Workflow must contain at least one node", "WORKFLOW_EMPTY");
  }

  const nodeIds = new Set<string>();
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    if (!node || typeof node !== "object") {
      throw new AppError(400, `Node at index ${i} is not a valid object`, "WORKFLOW_NODE_INVALID");
    }
    if (!node.id || typeof node.id !== "string") {
      throw new AppError(400, `Node at index ${i} is missing a valid "id" string`, "WORKFLOW_NODE_INVALID");
    }
    if (!node.type || typeof node.type !== "string") {
      throw new AppError(400, `Node "${node.id}" is missing a valid "type" string`, "WORKFLOW_NODE_INVALID");
    }
    if (nodeIds.has(node.id)) {
      throw new AppError(400, `Duplicate node id "${node.id}"`, "WORKFLOW_NODE_DUPLICATE");
    }
    nodeIds.add(node.id);
  }

  for (let i = 0; i < edges.length; i++) {
    const edge = edges[i];
    if (!edge || typeof edge !== "object") {
      throw new AppError(400, `Edge at index ${i} is not a valid object`, "WORKFLOW_EDGE_INVALID");
    }
    if (!edge.source || typeof edge.source !== "string") {
      throw new AppError(400, `Edge at index ${i} is missing a valid "source" string`, "WORKFLOW_EDGE_INVALID");
    }
    if (!edge.target || typeof edge.target !== "string") {
      throw new AppError(400, `Edge at index ${i} is missing a valid "target" string`, "WORKFLOW_EDGE_INVALID");
    }
    if (!nodeIds.has(edge.source)) {
      throw new AppError(400, `Edge at index ${i} references unknown source node "${edge.source}"`, "WORKFLOW_EDGE_INVALID");
    }
    if (!nodeIds.has(edge.target)) {
      throw new AppError(400, `Edge at index ${i} references unknown target node "${edge.target}"`, "WORKFLOW_EDGE_INVALID");
    }
  }
}

// Active workflow runs kept in memory for SSE streaming
export const activeRuns = new Map<
  string,
  { executor: WorkflowExecutor; events: ExecutionEvent[]; createdAt: number }
>();

/** Maximum number of concurrent active runs held in memory */
const MAX_ACTIVE_RUNS = 500;
/** Maximum age (ms) before an entry is evicted regardless of state */
const ACTIVE_RUN_TTL_MS = 30 * 60 * 1000; // 30 minutes
/** Maximum events stored per active run */
const MAX_EVENTS_PER_RUN = 1_000;
/** How often the sweep runs */
const SWEEP_INTERVAL_MS = 60 * 1000; // every 60 seconds

/** Periodic sweep that evicts stale entries from activeRuns */
const _sweepInterval = setInterval(() => {
  const now = Date.now();
  for (const [id, entry] of activeRuns) {
    if (now - entry.createdAt > ACTIVE_RUN_TTL_MS) {
      activeRuns.delete(id);
      logger.info({ runId: id }, "Evicted stale activeRuns entry (TTL exceeded)");
    }
  }
}, SWEEP_INTERVAL_MS);

// Allow the process to exit without waiting for the sweep timer
if (_sweepInterval.unref) _sweepInterval.unref();

const workflowsPlugin: FastifyPluginAsync = async (fastify) => {
    // GET / — list user's workflows
  fastify.get("/", { preHandler: fastifyRequireAuth }, async (request, _reply) => {
    const limit = Math.min(Math.max(Number((request.query as { limit?: string }).limit) || 20, 1), 100);
    const offset = Math.max(Number((request.query as { offset?: string }).offset) || 0, 0);

    const whereClause = eq(workflows.userId, request.userId!);

    const [workflowList, totalResult] = await Promise.all([
      db
        .select()
        .from(workflows)
        .where(whereClause)
        .orderBy(desc(workflows.createdAt))
        .limit(limit)
        .offset(offset),
      db
        .select({ value: count() })
        .from(workflows)
        .where(whereClause),
    ]);

    return { workflows: workflowList, total: totalResult[0].value };
  });

    // POST / — create workflow
  fastify.post("/", { preHandler: fastifyRequireAuth }, async (request, reply) => {
    const { name, description, definition } = request.body as { name?: string; description?: string; definition?: Record<string, unknown> };

    if (!name || typeof name !== "string" || name.trim().length === 0) {
      throw new AppError(400, "Name is required", "WORKFLOW_NAME_REQUIRED");
    }
    if (!definition || !Array.isArray(definition.nodes) || !Array.isArray(definition.edges)) {
      throw new AppError(
        400,
        "Definition must include nodes and edges arrays",
        "WORKFLOW_DEFINITION_INVALID",
      );
    }

    validateWorkflowDefinition(definition);

    const now = new Date();
    const [workflow] = await db
      .insert(workflows)
      .values({
        id: randomUUID(),
        userId: request.userId!,
        name: name.trim(),
        description: description?.trim() || null,
        definition,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    reply.code(201);
    return workflow;
  });

    // GET /:id — get workflow by ID
  fastify.get("/:id", { preHandler: fastifyRequireAuth }, async (request, _reply) => {
    const { id } = request.params as { id: string };

    const [workflow] = await db
      .select()
      .from(workflows)
      .where(and(eq(workflows.id, id), eq(workflows.userId, request.userId!)))
      .limit(1);

    if (!workflow) throw new AppError(404, "Workflow not found", "WORKFLOW_NOT_FOUND");

    return workflow;
  });

    // PUT /:id — update workflow
  fastify.put("/:id", { preHandler: fastifyRequireAuth }, async (request, _reply) => {
    const { id } = request.params as { id: string };

    const [workflow] = await db
      .select()
      .from(workflows)
      .where(and(eq(workflows.id, id), eq(workflows.userId, request.userId!)))
      .limit(1);

    if (!workflow) throw new AppError(404, "Workflow not found", "WORKFLOW_NOT_FOUND");

    const { name, description, definition } = request.body as { name?: string; description?: string; definition?: Record<string, unknown> };

    const data: Record<string, unknown> = { updatedAt: new Date() };
    if (name !== undefined) data.name = name.trim();
    if (description !== undefined) data.description = description?.trim() || null;
    if (definition !== undefined) {
      if (!Array.isArray(definition.nodes) || !Array.isArray(definition.edges)) {
        throw new AppError(
          400,
          "Definition must include nodes and edges arrays",
          "WORKFLOW_DEFINITION_INVALID",
        );
      }
      validateWorkflowDefinition(definition);
      data.definition = definition;
      data.version = workflow.version + 1;
    }

    const [updated] = await db
      .update(workflows)
      .set(data)
      .where(eq(workflows.id, workflow.id))
      .returning();

    return updated;
  });

    // DELETE /:id — delete workflow
  fastify.delete("/:id", { preHandler: fastifyRequireAuth }, async (request, _reply) => {
    const { id } = request.params as { id: string };

    const [workflow] = await db
      .select()
      .from(workflows)
      .where(and(eq(workflows.id, id), eq(workflows.userId, request.userId!)))
      .limit(1);

    if (!workflow) throw new AppError(404, "Workflow not found", "WORKFLOW_NOT_FOUND");

    await db.delete(workflows).where(eq(workflows.id, workflow.id));
    return { success: true };
  });

    // POST /:id/publish — publish workflow
  fastify.post("/:id/publish", { preHandler: fastifyRequireAuth }, async (request, _reply) => {
    const { id } = request.params as { id: string };

    const [workflow] = await db
      .select()
      .from(workflows)
      .where(and(eq(workflows.id, id), eq(workflows.userId, request.userId!)))
      .limit(1);

    if (!workflow) throw new AppError(404, "Workflow not found", "WORKFLOW_NOT_FOUND");

    const [updated] = await db
      .update(workflows)
      .set({ published: true, updatedAt: new Date() })
      .where(eq(workflows.id, workflow.id))
      .returning();

    return updated;
  });

    // POST /:id/run — execute workflow
  fastify.post("/:id/run", { preHandler: fastifyRequireAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };

    const [workflow] = await db
      .select()
      .from(workflows)
      .where(and(eq(workflows.id, id), eq(workflows.userId, request.userId!)))
      .limit(1);

    if (!workflow) throw new AppError(404, "Workflow not found", "WORKFLOW_NOT_FOUND");

    const { inputs } = request.body as { inputs?: Record<string, unknown> };

    const [run] = await db
      .insert(workflowRuns)
      .values({
        id: randomUUID(),
        workflowId: workflow.id,
        userId: request.userId!,
        status: "running",
        inputs: inputs || {},
      })
      .returning();

    // Import executor dynamically and start execution in background
    const { WorkflowExecutor: ExecutorClass } = await import("../workflow/executor.js");
    const executor = new ExecutorClass(workflow.definition as WorkflowDefinition, run.id, request.userId!);

    // Enforce bounded map size — evict oldest entry if at capacity
    if (activeRuns.size >= MAX_ACTIVE_RUNS) {
      const oldestKey = activeRuns.keys().next().value;
      if (oldestKey) {
        activeRuns.delete(oldestKey);
        logger.warn({ evictedRunId: oldestKey }, "Evicted oldest activeRuns entry (map at capacity)");
      }
    }

    activeRuns.set(run.id, { executor, events: [], createdAt: Date.now() });

    // Run execution in background (do NOT await)
    void (async () => {
      try {
        for await (const event of executor.run(inputs || {})) {
          const entry = activeRuns.get(run.id);
          if (entry) {
            if (entry.events.length >= MAX_EVENTS_PER_RUN) {
              // Drop oldest events to stay within bounds
              entry.events.splice(0, entry.events.length - MAX_EVENTS_PER_RUN + 100);
            }
            entry.events.push(event);
          }

          if (event.type === "workflow_complete") {
            await db
              .update(workflowRuns)
              .set({ status: "done", outputs: (event.outputs as Record<string, unknown>) ?? {}, endedAt: new Date() })
              .where(eq(workflowRuns.id, run.id));
          } else if (event.type === "workflow_error") {
            await db
              .update(workflowRuns)
              .set({ status: "failed", error: event.error ?? "Unknown error", endedAt: new Date() })
              .where(eq(workflowRuns.id, run.id));
          }
        }
      } catch (err) {
        logger.error({ err, runId: run.id }, "Workflow execution failed");
        await db
          .update(workflowRuns)
          .set({ status: "failed", error: (err as Error).message, endedAt: new Date() })
          .where(eq(workflowRuns.id, run.id))
          .catch(() => {});
      } finally {
        // Clean up after 5 minutes
        setTimeout(() => activeRuns.delete(run.id), 5 * 60 * 1000);
      }
    })();

    reply.code(201);
    return { run_id: run.id };
  });

    // GET /:id/runs — list runs for workflow
  fastify.get("/:id/runs", { preHandler: fastifyRequireAuth }, async (request, _reply) => {
    const { id } = request.params as { id: string };

    const [workflow] = await db
      .select()
      .from(workflows)
      .where(and(eq(workflows.id, id), eq(workflows.userId, request.userId!)))
      .limit(1);

    if (!workflow) throw new AppError(404, "Workflow not found", "WORKFLOW_NOT_FOUND");

    const runs = await db
      .select()
      .from(workflowRuns)
      .where(eq(workflowRuns.workflowId, workflow.id))
      .orderBy(desc(workflowRuns.startedAt));

    return { runs };
  });

    // GET /runs/:runId — get run status
  fastify.get("/runs/:runId", { preHandler: fastifyRequireAuth }, async (request, _reply) => {
    const { runId } = request.params as { runId: string };

    const [run] = await db
      .select()
      .from(workflowRuns)
      .where(and(eq(workflowRuns.id, runId), eq(workflowRuns.userId, request.userId!)))
      .limit(1);

    if (!run) throw new AppError(404, "Workflow run not found", "WORKFLOW_RUN_NOT_FOUND");

    return run;
  });

    // GET /runs/:runId/stream — SSE endpoint for run events
  fastify.get("/runs/:runId/stream", { preHandler: fastifyRequireAuth }, async (request, reply) => {
    const { runId } = request.params as { runId: string };

    const [run] = await db
      .select()
      .from(workflowRuns)
      .where(and(eq(workflowRuns.id, runId), eq(workflowRuns.userId, request.userId!)))
      .limit(1);

    if (!run) throw new AppError(404, "Workflow run not found", "WORKFLOW_RUN_NOT_FOUND");

    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
    });

    const active = activeRuns.get(run.id);

    // If run is already complete or no active executor, replay stored events and close
    if (!active) {
      if (run.status === "done") {
        reply.raw.write(`data: ${JSON.stringify({ type: "workflow_complete", data: run.outputs })}\n\n`);
      } else if (run.status === "failed") {
        reply.raw.write(`data: ${JSON.stringify({ type: "workflow_error", data: { message: run.error } })}\n\n`);
      }
      reply.raw.end();
      return reply;
    }

    // Replay already-emitted events
    let cursor = 0;
    for (const event of active.events) {
      reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
      cursor++;
    }

    // Poll for new events
    const interval = setInterval(() => {
      const entry = activeRuns.get(run.id);
      if (!entry) {
        clearInterval(interval);
        reply.raw.end();
        return;
      }

      while (cursor < entry.events.length) {
        const event = entry.events[cursor];
        reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
        cursor++;

        if (event.type === "workflow_complete" || event.type === "workflow_error") {
          clearInterval(interval);
          reply.raw.end();
          return;
        }
      }
    }, 500);

    request.raw.on("close", () => clearInterval(interval));

    // Prevent Fastify from trying to send a response — we're handling it via raw
    return reply;
  });

    // POST /runs/:runId/gate — resume human gate
  fastify.post("/runs/:runId/gate", { preHandler: fastifyRequireAuth }, async (request, _reply) => {
    const { runId } = request.params as { runId: string };

    const [run] = await db
      .select()
      .from(workflowRuns)
      .where(and(eq(workflowRuns.id, runId), eq(workflowRuns.userId, request.userId!)))
      .limit(1);

    if (!run) throw new AppError(404, "Workflow run not found", "WORKFLOW_RUN_NOT_FOUND");

    const { choice, nodeId } = request.body as { choice?: string; nodeId?: string };
    if (!choice) throw new AppError(400, "Choice is required", "GATE_CHOICE_REQUIRED");
    if (!nodeId) throw new AppError(400, "nodeId is required", "GATE_NODE_REQUIRED");

    const active = activeRuns.get(run.id);
    if (!active) {
      throw new AppError(400, "No active executor for this run", "GATE_NO_ACTIVE_RUN");
    }

    active.executor.resumeGate(nodeId, choice);
    return { success: true };
  });

  // ─── Self-healing config routes (4.21) ──────────────────────────────────────

  /**
   * GET /api/workflows/self-healing/config
   * Returns current global self-healing defaults. Admins and regular users can read.
   */
  fastify.get("/self-healing/config", { preHandler: fastifyRequireAuth }, async (_request, reply) => {
    return reply.send({
      success: true,
      config: {
        enabled:     selfHealingConfig.enabled,
        maxAttempts: selfHealingConfig.maxAttempts,
        strategies:  selfHealingConfig.strategies,
      },
      note: "Per-node overrides can be set in the workflow node's 'selfHealing' field.",
    });
  });

  /**
   * PUT /api/workflows/self-healing/config
   * Update global self-healing defaults at runtime (no restart required).
   * Body: { enabled?: boolean, maxAttempts?: number, strategies?: string[] }
   */
  fastify.put("/self-healing/config", { preHandler: fastifyRequireAuth }, async (request, reply) => {
    const body = request.body as Record<string, unknown>;

    if (typeof body.enabled === "boolean") {
      selfHealingConfig.enabled = body.enabled;
    }

    if (typeof body.maxAttempts === "number") {
      const clamped = Math.min(Math.max(1, Math.floor(body.maxAttempts)), 5);
      selfHealingConfig.maxAttempts = clamped;
    }

    const VALID_STRATEGIES = new Set(["retry_with_adjusted_params", "swap_provider", "rewrite_prompt"]);
    if (Array.isArray(body.strategies)) {
      const parsed = (body.strategies as unknown[]).filter(
        (s): s is "retry_with_adjusted_params" | "swap_provider" | "rewrite_prompt" =>
          typeof s === "string" && VALID_STRATEGIES.has(s)
      );
      if (parsed.length > 0) selfHealingConfig.strategies = parsed;
    }

    logger.info({ userId: request.userId, config: selfHealingConfig }, "Self-healing config updated");

    return reply.send({
      success: true,
      config: {
        enabled:     selfHealingConfig.enabled,
        maxAttempts: selfHealingConfig.maxAttempts,
        strategies:  selfHealingConfig.strategies,
      },
    });
  });
};

export default workflowsPlugin;
