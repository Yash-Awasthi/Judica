import { Router, Response } from "express";
import { requireAuth } from "../middleware/auth.js";
import prisma from "../lib/db.js";
import { AuthRequest } from "../types/index.js";
import { AppError } from "../middleware/errorHandler.js";
import { runResearch } from "../services/research.service.js";
import logger from "../lib/logger.js";

const router = Router();

// POST /api/research — start research job
router.post("/", requireAuth, async (req: AuthRequest, res: Response) => {
  const { query } = req.body;
  if (!query || typeof query !== "string" || query.trim().length === 0) {
    throw new AppError(400, "Query is required", "RESEARCH_QUERY_REQUIRED");
  }
  if (query.length > 2000) {
    throw new AppError(400, "Query too long (max 2000 chars)", "RESEARCH_QUERY_TOO_LONG");
  }

  const userId = req.userId!;

  // Check for running jobs (limit 2 concurrent per user)
  const running = await prisma.researchJob.count({
    where: { userId, status: "running" },
  });
  if (running >= 2) {
    throw new AppError(429, "Maximum 2 concurrent research jobs", "RESEARCH_LIMIT");
  }

  const job = await prisma.researchJob.create({
    data: { userId, query: query.trim() },
  });

  // Run research async
  runResearch(job.id, userId, query.trim()).catch((err) => {
    logger.error({ err, jobId: job.id }, "Research job failed");
  });

  res.status(201).json({ id: job.id, status: "pending", query: query.trim() });
});

// GET /api/research — list user's jobs
router.get("/", requireAuth, async (req: AuthRequest, res: Response) => {
  const jobs = await prisma.researchJob.findMany({
    where: { userId: req.userId! },
    orderBy: { createdAt: "desc" },
    take: 20,
    select: {
      id: true,
      query: true,
      status: true,
      createdAt: true,
      updatedAt: true,
    },
  });
  res.json({ jobs });
});

// GET /api/research/:id — get job detail
router.get("/:id", requireAuth, async (req: AuthRequest, res: Response) => {
  const job = await prisma.researchJob.findFirst({
    where: { id: req.params.id, userId: req.userId! },
  });
  if (!job) throw new AppError(404, "Research job not found", "RESEARCH_NOT_FOUND");
  res.json(job);
});

// GET /api/research/:id/stream — SSE streaming
router.get("/:id/stream", requireAuth, async (req: AuthRequest, res: Response) => {
  const job = await prisma.researchJob.findFirst({
    where: { id: req.params.id, userId: req.userId! },
  });
  if (!job) throw new AppError(404, "Research job not found", "RESEARCH_NOT_FOUND");

  // If already done, send report immediately
  if (job.status === "done" || job.status === "failed") {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    if (job.status === "done") {
      res.write(`data: ${JSON.stringify({ type: "report_ready", report: job.report })}\n\n`);
    } else {
      res.write(`data: ${JSON.stringify({ type: "error", message: "Research failed" })}\n\n`);
    }
    res.write(`data: ${JSON.stringify({ type: "done", jobId: job.id })}\n\n`);
    return res.end();
  }

  // For pending/running jobs, poll and stream updates
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  let lastStepCount = 0;
  const interval = setInterval(async () => {
    try {
      const current = await prisma.researchJob.findUnique({ where: { id: job.id } });
      if (!current) {
        clearInterval(interval);
        res.end();
        return;
      }

      const steps = (current.steps as any[]) || [];
      // Send new completed steps
      for (let i = lastStepCount; i < steps.length; i++) {
        if (steps[i].status === "done") {
          res.write(`data: ${JSON.stringify({
            type: "step_complete",
            stepIndex: i,
            question: steps[i].question,
            answer: steps[i].answer,
          })}\n\n`);
          lastStepCount = i + 1;
        }
      }

      if (current.status === "done") {
        res.write(`data: ${JSON.stringify({ type: "report_ready", report: current.report })}\n\n`);
        res.write(`data: ${JSON.stringify({ type: "done", jobId: current.id })}\n\n`);
        clearInterval(interval);
        res.end();
      } else if (current.status === "failed") {
        res.write(`data: ${JSON.stringify({ type: "error", message: "Research failed" })}\n\n`);
        clearInterval(interval);
        res.end();
      }
    } catch (err) {
      logger.error({ err }, "Research stream poll error");
    }
  }, 2000);

  req.on("close", () => clearInterval(interval));
});

// DELETE /api/research/:id — delete job
router.delete("/:id", requireAuth, async (req: AuthRequest, res: Response) => {
  const job = await prisma.researchJob.findFirst({
    where: { id: req.params.id, userId: req.userId! },
  });
  if (!job) throw new AppError(404, "Research job not found", "RESEARCH_NOT_FOUND");

  await prisma.researchJob.delete({ where: { id: job.id } });
  res.json({ success: true });
});

export default router;
