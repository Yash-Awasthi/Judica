import { FastifyPluginAsync } from "fastify";
import { randomUUID } from "crypto";
import { db } from "../lib/drizzle.js";
import { workflows, workflowRuns } from "../db/schema/workflows.js";
import { eq, and, desc, count, sql } from "drizzle-orm";
import { fastifyRequireAuth } from "../middleware/fastifyAuth.js";
import { AppError } from "../middleware/errorHandler.js";
import logger from "../lib/logger.js";
import type { ExecutionEvent } from "../workflow/types.js";
import type { WorkflowExecutor } from "../workflow/executor.js";

/**
 * Validate that a workflow definition has well-formed node and edge structures.
 * Throws AppError on malformed definitions to prevent runtime crashes.
 */
function validateWorkflowDefinition(definition: any): void {
  const { nodes, edges } = definition;

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
  /**
   * @openapi
   * /workflows:
   *   get:
   *     summary: List user's workflows
   *     description: Returns a paginated list of workflows belonging to the authenticated user.
   *     tags:
   *       - Workflows
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: query
   *         name: limit
   *         schema:
   *           type: integer
   *           minimum: 1
   *           maximum: 100
   *           default: 20
   *         description: Number of workflows to return
   *       - in: query
   *         name: offset
   *         schema:
   *           type: integer
   *           minimum: 0
   *           default: 0
   *         description: Number of workflows to skip
   *     responses:
   *       200:
   *         description: Paginated list of workflows
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 workflows:
   *                   type: array
   *                   items:
   *                     $ref: '#/components/schemas/Workflow'
   *                 total:
   *                   type: integer
   *       401:
   *         description: Unauthorized
   */
  // GET / — list user's workflows
  fastify.get("/", { preHandler: fastifyRequireAuth }, async (request, reply) => {
    const limit = Math.min(Math.max(Number((request.query as any).limit) || 20, 1), 100);
    const offset = Math.max(Number((request.query as any).offset) || 0, 0);

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

  /**
   * @openapi
   * /workflows:
   *   post:
   *     summary: Create a new workflow
   *     description: Creates a new workflow with the given name, description, and graph definition.
   *     tags:
   *       - Workflows
   *     security:
   *       - bearerAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required:
   *               - name
   *               - definition
   *             properties:
   *               name:
   *                 type: string
   *                 description: Workflow name
   *               description:
   *                 type: string
   *                 description: Optional workflow description
   *               definition:
   *                 type: object
   *                 required:
   *                   - nodes
   *                   - edges
   *                 properties:
   *                   nodes:
   *                     type: array
   *                     items:
   *                       type: object
   *                   edges:
   *                     type: array
   *                     items:
   *                       type: object
   *     responses:
   *       201:
   *         description: Workflow created successfully
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/Workflow'
   *       400:
   *         description: Invalid request body
   *       401:
   *         description: Unauthorized
   */
  // POST / — create workflow
  fastify.post("/", { preHandler: fastifyRequireAuth }, async (request, reply) => {
    const { name, description, definition } = request.body as any;

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

  /**
   * @openapi
   * /workflows/{id}:
   *   get:
   *     summary: Get a workflow by ID
   *     description: Returns a single workflow belonging to the authenticated user.
   *     tags:
   *       - Workflows
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *         description: Workflow ID
   *     responses:
   *       200:
   *         description: Workflow details
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/Workflow'
   *       401:
   *         description: Unauthorized
   *       404:
   *         description: Workflow not found
   */
  // GET /:id — get workflow by ID
  fastify.get("/:id", { preHandler: fastifyRequireAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };

    const [workflow] = await db
      .select()
      .from(workflows)
      .where(and(eq(workflows.id, id), eq(workflows.userId, request.userId!)))
      .limit(1);

    if (!workflow) throw new AppError(404, "Workflow not found", "WORKFLOW_NOT_FOUND");

    return workflow;
  });

  /**
   * @openapi
   * /workflows/{id}:
   *   put:
   *     summary: Update a workflow
   *     description: Updates an existing workflow's name, description, or definition. Updating the definition increments the version.
   *     tags:
   *       - Workflows
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *         description: Workflow ID
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               name:
   *                 type: string
   *                 description: Updated workflow name
   *               description:
   *                 type: string
   *                 description: Updated workflow description
   *               definition:
   *                 type: object
   *                 properties:
   *                   nodes:
   *                     type: array
   *                     items:
   *                       type: object
   *                   edges:
   *                     type: array
   *                     items:
   *                       type: object
   *     responses:
   *       200:
   *         description: Updated workflow
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/Workflow'
   *       400:
   *         description: Invalid definition
   *       401:
   *         description: Unauthorized
   *       404:
   *         description: Workflow not found
   */
  // PUT /:id — update workflow
  fastify.put("/:id", { preHandler: fastifyRequireAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };

    const [workflow] = await db
      .select()
      .from(workflows)
      .where(and(eq(workflows.id, id), eq(workflows.userId, request.userId!)))
      .limit(1);

    if (!workflow) throw new AppError(404, "Workflow not found", "WORKFLOW_NOT_FOUND");

    const { name, description, definition } = request.body as any;

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

  /**
   * @openapi
   * /workflows/{id}:
   *   delete:
   *     summary: Delete a workflow
   *     description: Permanently deletes a workflow belonging to the authenticated user.
   *     tags:
   *       - Workflows
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *         description: Workflow ID
   *     responses:
   *       200:
   *         description: Workflow deleted
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 success:
   *                   type: boolean
   *       401:
   *         description: Unauthorized
   *       404:
   *         description: Workflow not found
   */
  // DELETE /:id — delete workflow
  fastify.delete("/:id", { preHandler: fastifyRequireAuth }, async (request, reply) => {
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

  /**
   * @openapi
   * /workflows/{id}/publish:
   *   post:
   *     summary: Publish a workflow
   *     description: Marks a workflow as published so it can be used by others.
   *     tags:
   *       - Workflows
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *         description: Workflow ID
   *     responses:
   *       200:
   *         description: Published workflow
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/Workflow'
   *       401:
   *         description: Unauthorized
   *       404:
   *         description: Workflow not found
   */
  // POST /:id/publish — publish workflow
  fastify.post("/:id/publish", { preHandler: fastifyRequireAuth }, async (request, reply) => {
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

  /**
   * @openapi
   * /workflows/{id}/run:
   *   post:
   *     summary: Execute a workflow
   *     description: Starts an asynchronous execution of the workflow. Returns a run ID that can be used to track progress via the SSE stream endpoint.
   *     tags:
   *       - Workflows
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *         description: Workflow ID
   *     requestBody:
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               inputs:
   *                 type: object
   *                 description: Input values for the workflow execution
   *     responses:
   *       201:
   *         description: Workflow run started
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 run_id:
   *                   type: string
   *                   description: The ID of the created workflow run
   *       401:
   *         description: Unauthorized
   *       404:
   *         description: Workflow not found
   */
  // POST /:id/run — execute workflow
  fastify.post("/:id/run", { preHandler: fastifyRequireAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };

    const [workflow] = await db
      .select()
      .from(workflows)
      .where(and(eq(workflows.id, id), eq(workflows.userId, request.userId!)))
      .limit(1);

    if (!workflow) throw new AppError(404, "Workflow not found", "WORKFLOW_NOT_FOUND");

    const { inputs } = request.body as any;

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
    const executor = new ExecutorClass(workflow.definition as any, run.id, request.userId!);

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
    (async () => {
      try {
        for await (const event of executor.run(inputs || {})) {
          const entry = activeRuns.get(run.id);
          if (entry) entry.events.push(event);

          if (event.type === "workflow_complete") {
            await db
              .update(workflowRuns)
              .set({ status: "done", outputs: (event.outputs as any) ?? {}, endedAt: new Date() })
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

  /**
   * @openapi
   * /workflows/{id}/runs:
   *   get:
   *     summary: List runs for a workflow
   *     description: Returns all execution runs for the specified workflow, ordered by most recent first.
   *     tags:
   *       - Workflows
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *         description: Workflow ID
   *     responses:
   *       200:
   *         description: List of workflow runs
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 runs:
   *                   type: array
   *                   items:
   *                     $ref: '#/components/schemas/WorkflowRun'
   *       401:
   *         description: Unauthorized
   *       404:
   *         description: Workflow not found
   */
  // GET /:id/runs — list runs for workflow
  fastify.get("/:id/runs", { preHandler: fastifyRequireAuth }, async (request, reply) => {
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

  /**
   * @openapi
   * /workflows/runs/{runId}:
   *   get:
   *     summary: Get run status
   *     description: Returns the current status and details of a specific workflow run.
   *     tags:
   *       - Workflows
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: runId
   *         required: true
   *         schema:
   *           type: string
   *         description: Workflow run ID
   *     responses:
   *       200:
   *         description: Workflow run details
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/WorkflowRun'
   *       401:
   *         description: Unauthorized
   *       404:
   *         description: Workflow run not found
   */
  // GET /runs/:runId — get run status
  fastify.get("/runs/:runId", { preHandler: fastifyRequireAuth }, async (request, reply) => {
    const { runId } = request.params as { runId: string };

    const [run] = await db
      .select()
      .from(workflowRuns)
      .where(and(eq(workflowRuns.id, runId), eq(workflowRuns.userId, request.userId!)))
      .limit(1);

    if (!run) throw new AppError(404, "Workflow run not found", "WORKFLOW_RUN_NOT_FOUND");

    return run;
  });

  /**
   * @openapi
   * /workflows/runs/{runId}/stream:
   *   get:
   *     summary: Stream run events via SSE
   *     description: Opens a Server-Sent Events stream for real-time workflow execution events. Replays past events then streams new ones until completion.
   *     tags:
   *       - Workflows
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: runId
   *         required: true
   *         schema:
   *           type: string
   *         description: Workflow run ID
   *     responses:
   *       200:
   *         description: SSE event stream
   *         content:
   *           text/event-stream:
   *             schema:
   *               type: string
   *       401:
   *         description: Unauthorized
   *       404:
   *         description: Workflow run not found
   */
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

  /**
   * @openapi
   * /workflows/runs/{runId}/gate:
   *   post:
   *     summary: Resume a human gate
   *     description: Provides a human decision to resume a workflow execution that is paused at a gate node.
   *     tags:
   *       - Workflows
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: runId
   *         required: true
   *         schema:
   *           type: string
   *         description: Workflow run ID
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required:
   *               - choice
   *             properties:
   *               nodeId:
   *                 type: string
   *                 description: ID of the gate node to resume
   *               choice:
   *                 type: string
   *                 description: The human decision to apply at the gate
   *     responses:
   *       200:
   *         description: Gate resumed successfully
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 success:
   *                   type: boolean
   *       400:
   *         description: Missing choice or no active executor
   *       401:
   *         description: Unauthorized
   *       404:
   *         description: Workflow run not found
   */
  // POST /runs/:runId/gate — resume human gate
  fastify.post("/runs/:runId/gate", { preHandler: fastifyRequireAuth }, async (request, reply) => {
    const { runId } = request.params as { runId: string };

    const [run] = await db
      .select()
      .from(workflowRuns)
      .where(and(eq(workflowRuns.id, runId), eq(workflowRuns.userId, request.userId!)))
      .limit(1);

    if (!run) throw new AppError(404, "Workflow run not found", "WORKFLOW_RUN_NOT_FOUND");

    const { choice, nodeId } = request.body as any;
    if (!choice) throw new AppError(400, "Choice is required", "GATE_CHOICE_REQUIRED");

    const active = activeRuns.get(run.id);
    if (!active) {
      throw new AppError(400, "No active executor for this run", "GATE_NO_ACTIVE_RUN");
    }

    active.executor.resumeGate(nodeId, choice);
    return { success: true };
  });
};

export default workflowsPlugin;
