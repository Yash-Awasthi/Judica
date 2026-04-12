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

/**
 * @openapi
 * /api/queue/stats:
 *   get:
 *     tags:
 *       - Queue
 *     summary: Get stats for all background job queues
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Queue statistics
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: object
 *                   properties:
 *                     ingestion:
 *                       type: object
 *                       properties:
 *                         active:
 *                           type: integer
 *                         waiting:
 *                           type: integer
 *                         completed:
 *                           type: integer
 *                         failed:
 *                           type: integer
 *                     research:
 *                       type: object
 *                     repo-ingestion:
 *                       type: object
 *                     compaction:
 *                       type: object
 *       401:
 *         description: Unauthorized
 */
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

/**
 * @openapi
 * /api/queue/jobs/{queueName}/{jobId}:
 *   get:
 *     tags:
 *       - Queue
 *     summary: Get job status (admin only)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: queueName
 *         required: true
 *         schema:
 *           type: string
 *           enum:
 *             - ingestion
 *             - research
 *             - repo-ingestion
 *             - compaction
 *         description: Queue name
 *       - in: path
 *         name: jobId
 *         required: true
 *         schema:
 *           type: string
 *         description: Job ID
 *     responses:
 *       200:
 *         description: Job details
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: object
 *                   properties:
 *                     id:
 *                       type: string
 *                     name:
 *                       type: string
 *                     state:
 *                       type: string
 *                     data:
 *                       type: object
 *                     progress:
 *                       type: number
 *                     attemptsMade:
 *                       type: integer
 *                     timestamp:
 *                       type: number
 *                     finishedOn:
 *                       type: number
 *                       nullable: true
 *                     failedReason:
 *                       type: string
 *                       nullable: true
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Queue or job not found
 */
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

/**
 * @openapi
 * /api/queue/jobs/{queueName}/{jobId}:
 *   delete:
 *     tags:
 *       - Queue
 *     summary: Cancel a job (admin only)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: queueName
 *         required: true
 *         schema:
 *           type: string
 *           enum:
 *             - ingestion
 *             - research
 *             - repo-ingestion
 *             - compaction
 *         description: Queue name
 *       - in: path
 *         name: jobId
 *         required: true
 *         schema:
 *           type: string
 *         description: Job ID
 *     responses:
 *       200:
 *         description: Job cancelled
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                 jobId:
 *                   type: string
 *                 previousState:
 *                   type: string
 *       400:
 *         description: Cannot cancel job in current state
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Queue or job not found
 */
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
