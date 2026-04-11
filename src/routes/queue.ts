import { Router } from "express";
import type { Response } from "express";
import type { AuthRequest } from "../types/index.js";
import { ingestionQueue, researchQueue, repoQueue, compactionQueue } from "../queue/queues.js";
import { requireRole } from "../middleware/rbac.js";

const router = Router();

async function getQueueStats(queue: typeof ingestionQueue) {
  const [active, waiting, completed, failed] = await Promise.all([
    queue.getActiveCount(),
    queue.getWaitingCount(),
    queue.getCompletedCount(),
    queue.getFailedCount(),
  ]);
  return { active, waiting, completed, failed };
}

// GET /stats — queue stats
router.get("/stats", async (_req: AuthRequest, res: Response) => {
  const [ingestion, research, repo, compaction] = await Promise.all([
    getQueueStats(ingestionQueue),
    getQueueStats(researchQueue),
    getQueueStats(repoQueue),
    getQueueStats(compactionQueue),
  ]);

  res.json({
    data: { ingestion, research, "repo-ingestion": repo, compaction },
  });
});

// GET /jobs/:queueName/:jobId — job status (admin only)
router.get(
  "/jobs/:queueName/:jobId",
  requireRole("admin"),
  async (req: AuthRequest, res: Response) => {
    const queues: Record<string, typeof ingestionQueue> = {
      ingestion: ingestionQueue,
      research: researchQueue,
      "repo-ingestion": repoQueue,
      compaction: compactionQueue,
    };

    const queue = queues[req.params.queueName];
    if (!queue) {
      res.status(404).json({ error: "Queue not found" });
      return;
    }

    const job = await queue.getJob(req.params.jobId);
    if (!job) {
      res.status(404).json({ error: "Job not found" });
      return;
    }

    const state = await job.getState();
    res.json({
      data: {
        id: job.id,
        name: job.name,
        state,
        data: job.data,
        progress: job.progress,
        attemptsMade: job.attemptsMade,
        timestamp: job.timestamp,
        finishedOn: job.finishedOn,
        failedReason: job.failedReason,
      },
    });
  }
);

// DELETE /jobs/:queueName/:jobId — cancel job (admin only)
router.delete(
  "/jobs/:queueName/:jobId",
  requireRole("admin"),
  async (req: AuthRequest, res: Response) => {
    const queues: Record<string, typeof ingestionQueue> = {
      ingestion: ingestionQueue,
      research: researchQueue,
      "repo-ingestion": repoQueue,
      compaction: compactionQueue,
    };

    const queue = queues[req.params.queueName];
    if (!queue) {
      res.status(404).json({ error: "Queue not found" });
      return;
    }

    const job = await queue.getJob(req.params.jobId);
    if (!job) {
      res.status(404).json({ error: "Job not found" });
      return;
    }

    const state = await job.getState();
    if (state === "active") {
      await job.moveToFailed(new Error("Cancelled by admin"), "0");
    } else if (state === "waiting" || state === "delayed") {
      await job.remove();
    } else {
      res.status(400).json({ error: `Cannot cancel job in '${state}' state` });
      return;
    }

    res.json({ message: "Job cancelled", jobId: job.id, previousState: state });
  }
);

export default router;
