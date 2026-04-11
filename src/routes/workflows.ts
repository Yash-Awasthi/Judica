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

// GET /:id — get workflow by ID
router.get("/:id", requireAuth, async (req: AuthRequest, res: Response) => {
  const workflow = await prisma.workflow.findFirst({
    where: { id: String(req.params.id), userId: req.userId! },
  });
  if (!workflow) throw new AppError(404, "Workflow not found", "WORKFLOW_NOT_FOUND");

  res.json(workflow);
});

// PUT /:id — update workflow
router.put("/:id", requireAuth, async (req: AuthRequest, res: Response) => {
  const workflow = await prisma.workflow.findFirst({
    where: { id: String(req.params.id), userId: req.userId! },
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

// DELETE /:id — delete workflow
router.delete("/:id", requireAuth, async (req: AuthRequest, res: Response) => {
  const workflow = await prisma.workflow.findFirst({
    where: { id: String(req.params.id), userId: req.userId! },
  });
  if (!workflow) throw new AppError(404, "Workflow not found", "WORKFLOW_NOT_FOUND");

  await prisma.workflow.delete({ where: { id: workflow.id } });
  res.json({ success: true });
});

// POST /:id/publish — publish workflow
router.post("/:id/publish", requireAuth, async (req: AuthRequest, res: Response) => {
  const workflow = await prisma.workflow.findFirst({
    where: { id: String(req.params.id), userId: req.userId! },
  });
  if (!workflow) throw new AppError(404, "Workflow not found", "WORKFLOW_NOT_FOUND");

  const updated = await prisma.workflow.update({
    where: { id: workflow.id },
    data: { published: true },
  });

  res.json(updated);
});

// POST /:id/run — execute workflow
router.post("/:id/run", requireAuth, async (req: AuthRequest, res: Response) => {
  const workflow = await prisma.workflow.findFirst({
    where: { id: String(req.params.id), userId: req.userId! },
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

// GET /:id/runs — list runs for workflow
router.get("/:id/runs", requireAuth, async (req: AuthRequest, res: Response) => {
  const workflow = await prisma.workflow.findFirst({
    where: { id: String(req.params.id), userId: req.userId! },
  });
  if (!workflow) throw new AppError(404, "Workflow not found", "WORKFLOW_NOT_FOUND");

  const runs = await prisma.workflowRun.findMany({
    where: { workflowId: workflow.id },
    orderBy: { startedAt: "desc" },
  });

  res.json({ runs });
});

// GET /runs/:runId — get run status
router.get("/runs/:runId", requireAuth, async (req: AuthRequest, res: Response) => {
  const run = await prisma.workflowRun.findFirst({
    where: { id: String(req.params.runId), userId: req.userId! },
  });
  if (!run) throw new AppError(404, "Workflow run not found", "WORKFLOW_RUN_NOT_FOUND");

  res.json(run);
});

// GET /runs/:runId/stream — SSE endpoint for run events
router.get("/runs/:runId/stream", requireAuth, async (req: AuthRequest, res: Response) => {
  const run = await prisma.workflowRun.findFirst({
    where: { id: String(req.params.runId), userId: req.userId! },
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

// POST /runs/:runId/gate — resume human gate
router.post("/runs/:runId/gate", requireAuth, async (req: AuthRequest, res: Response) => {
  const run = await prisma.workflowRun.findFirst({
    where: { id: String(req.params.runId), userId: req.userId! },
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
