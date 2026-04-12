import { Router, Response } from "express";
import { requireAuth } from "../middleware/auth.js";
import prisma from "../lib/db.js";
import type { AuthRequest } from "../types/index.js";
import { AppError } from "../middleware/errorHandler.js";
import logger from "../lib/logger.js";
import type { ExecutionEvent } from "../workflow/types.js";
import type { WorkflowExecutor } from "../workflow/executor.js";

const router = Router();

// Active workflow runs kept in memory for SSE streaming
export const activeRuns = new Map<
  string,
  { executor: WorkflowExecutor; events: ExecutionEvent[] }
>();

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
router.get("/", requireAuth, async (req: AuthRequest, res: Response) => {
  const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 100);
  const offset = Math.max(Number(req.query.offset) || 0, 0);

  const [workflows, total] = await Promise.all([
    prisma.workflow.findMany({
      where: { userId: req.userId! },
      orderBy: { createdAt: "desc" },
      take: limit,
      skip: offset,
    }),
    prisma.workflow.count({ where: { userId: req.userId! } }),
  ]);

  res.json({ workflows, total });
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
router.post("/", requireAuth, async (req: AuthRequest, res: Response) => {
  const { name, description, definition } = req.body;

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

  const workflow = await prisma.workflow.create({
    data: {
      userId: req.userId!,
      name: name.trim(),
      description: description?.trim() || null,
      definition,
    },
  });

  res.status(201).json(workflow);
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
router.get("/:id", requireAuth, async (req: AuthRequest, res: Response) => {
  const workflow = await prisma.workflow.findFirst({
    where: { id: String(req.params.id as string), userId: req.userId! },
  });
  if (!workflow) throw new AppError(404, "Workflow not found", "WORKFLOW_NOT_FOUND");

  res.json(workflow);
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
router.put("/:id", requireAuth, async (req: AuthRequest, res: Response) => {
  const workflow = await prisma.workflow.findFirst({
    where: { id: String(req.params.id as string), userId: req.userId! },
  });
  if (!workflow) throw new AppError(404, "Workflow not found", "WORKFLOW_NOT_FOUND");

  const { name, description, definition } = req.body;

  const data: Record<string, unknown> = {};
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
    data.definition = definition;
    data.version = workflow.version + 1;
  }

  const updated = await prisma.workflow.update({
    where: { id: workflow.id },
    data,
  });

  res.json(updated);
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
router.delete("/:id", requireAuth, async (req: AuthRequest, res: Response) => {
  const workflow = await prisma.workflow.findFirst({
    where: { id: String(req.params.id as string), userId: req.userId! },
  });
  if (!workflow) throw new AppError(404, "Workflow not found", "WORKFLOW_NOT_FOUND");

  await prisma.workflow.delete({ where: { id: workflow.id } });
  res.json({ success: true });
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
router.post("/:id/publish", requireAuth, async (req: AuthRequest, res: Response) => {
  const workflow = await prisma.workflow.findFirst({
    where: { id: String(req.params.id as string), userId: req.userId! },
  });
  if (!workflow) throw new AppError(404, "Workflow not found", "WORKFLOW_NOT_FOUND");

  const updated = await prisma.workflow.update({
    where: { id: workflow.id },
    data: { published: true },
  });

  res.json(updated);
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
router.post("/:id/run", requireAuth, async (req: AuthRequest, res: Response) => {
  const workflow = await prisma.workflow.findFirst({
    where: { id: String(req.params.id as string), userId: req.userId! },
  });
  if (!workflow) throw new AppError(404, "Workflow not found", "WORKFLOW_NOT_FOUND");

  const { inputs } = req.body;

  const run = await prisma.workflowRun.create({
    data: {
      workflowId: workflow.id,
      userId: req.userId!,
      status: "running",
      inputs: inputs || {},
    },
  });

  // Import executor dynamically and start execution in background
  const { WorkflowExecutor: ExecutorClass } = await import("../workflow/executor.js");
  const executor = new ExecutorClass(workflow.definition as any, run.id, req.userId!);

  activeRuns.set(run.id, { executor, events: [] });

  // Run execution in background (do NOT await)
  (async () => {
    try {
      for await (const event of executor.run(inputs || {})) {
        const entry = activeRuns.get(run.id);
        if (entry) entry.events.push(event);

        if (event.type === "workflow_complete") {
          await prisma.workflowRun.update({
            where: { id: run.id },
            data: { status: "done", outputs: (event.outputs as any) ?? {}, endedAt: new Date() },
          });
        } else if (event.type === "workflow_error") {
          await prisma.workflowRun.update({
            where: { id: run.id },
            data: { status: "failed", error: event.error ?? "Unknown error", endedAt: new Date() },
          });
        }
      }
    } catch (err) {
      logger.error({ err, runId: run.id }, "Workflow execution failed");
      await prisma.workflowRun.update({
        where: { id: run.id },
        data: { status: "failed", error: (err as Error).message, endedAt: new Date() },
      }).catch(() => {});
    } finally {
      // Clean up after 5 minutes
      setTimeout(() => activeRuns.delete(run.id), 5 * 60 * 1000);
    }
  })();

  res.status(201).json({ run_id: run.id });
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
router.get("/:id/runs", requireAuth, async (req: AuthRequest, res: Response) => {
  const workflow = await prisma.workflow.findFirst({
    where: { id: String(req.params.id as string), userId: req.userId! },
  });
  if (!workflow) throw new AppError(404, "Workflow not found", "WORKFLOW_NOT_FOUND");

  const runs = await prisma.workflowRun.findMany({
    where: { workflowId: workflow.id },
    orderBy: { startedAt: "desc" },
  });

  res.json({ runs });
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
router.get("/runs/:runId", requireAuth, async (req: AuthRequest, res: Response) => {
  const run = await prisma.workflowRun.findFirst({
    where: { id: String(req.params.runId as string), userId: req.userId! },
  });
  if (!run) throw new AppError(404, "Workflow run not found", "WORKFLOW_RUN_NOT_FOUND");

  res.json(run);
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
router.get("/runs/:runId/stream", requireAuth, async (req: AuthRequest, res: Response) => {
  const run = await prisma.workflowRun.findFirst({
    where: { id: String(req.params.runId as string), userId: req.userId! },
  });
  if (!run) throw new AppError(404, "Workflow run not found", "WORKFLOW_RUN_NOT_FOUND");

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  const active = activeRuns.get(run.id);

  // If run is already complete or no active executor, replay stored events and close
  if (!active) {
    if (run.status === "done") {
      res.write(`data: ${JSON.stringify({ type: "workflow_complete", data: run.outputs })}\n\n`);
    } else if (run.status === "failed") {
      res.write(`data: ${JSON.stringify({ type: "workflow_error", data: { message: run.error } })}\n\n`);
    }
    return res.end();
  }

  // Replay already-emitted events
  let cursor = 0;
  for (const event of active.events) {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
    cursor++;
  }

  // Poll for new events
  const interval = setInterval(() => {
    const entry = activeRuns.get(run.id);
    if (!entry) {
      clearInterval(interval);
      res.end();
      return;
    }

    while (cursor < entry.events.length) {
      const event = entry.events[cursor];
      res.write(`data: ${JSON.stringify(event)}\n\n`);
      cursor++;

      if (event.type === "workflow_complete" || event.type === "workflow_error") {
        clearInterval(interval);
        res.end();
        return;
      }
    }
  }, 500);

  req.on("close", () => clearInterval(interval));
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
router.post("/runs/:runId/gate", requireAuth, async (req: AuthRequest, res: Response) => {
  const run = await prisma.workflowRun.findFirst({
    where: { id: String(req.params.runId as string), userId: req.userId! },
  });
  if (!run) throw new AppError(404, "Workflow run not found", "WORKFLOW_RUN_NOT_FOUND");

  const { choice } = req.body;
  if (!choice) throw new AppError(400, "Choice is required", "GATE_CHOICE_REQUIRED");

  const active = activeRuns.get(run.id);
  if (!active) {
    throw new AppError(400, "No active executor for this run", "GATE_NO_ACTIVE_RUN");
  }

  active.executor.resumeGate(req.body.nodeId, choice);
  res.json({ success: true });
});

export default router;
