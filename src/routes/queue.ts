import type { FastifyPluginAsync } from "fastify";
import { fastifyRequireAdmin } from "../middleware/fastifyAuth.js";
import { ingestionQueue, researchQueue, repoQueue, compactionQueue } from "../queue/queues.js";

async function getQueueStats(queue: typeof ingestionQueue) {
  const [active, waiting, completed, failed] = await Promise.all([
    queue.getActiveCount(),
    queue.getWaitingCount(),
    queue.getCompletedCount(),
    queue.getFailedCount(),
  ]);
  return { active, waiting, completed, failed };
}

const queuePlugin: FastifyPluginAsync = async (fastify) => {
    // GET /stats — queue stats (admin only)
  fastify.get("/stats", { preHandler: fastifyRequireAdmin }, async (_request, _reply) => {
    const [ingestion, research, repo, compaction] = await Promise.all([
      getQueueStats(ingestionQueue),
      getQueueStats(researchQueue),
      getQueueStats(repoQueue),
      getQueueStats(compactionQueue),
    ]);

    return {
      data: { ingestion, research, "repo-ingestion": repo, compaction },
    };
  });

    // GET /jobs/:queueName/:jobId — job status (admin only)
  fastify.get(
    "/jobs/:queueName/:jobId",
    { preHandler: fastifyRequireAdmin },
    async (request, reply) => {
      const { queueName, jobId } = request.params as { queueName: string; jobId: string };
      const queues: Record<string, typeof ingestionQueue> = {
        ingestion: ingestionQueue,
        research: researchQueue,
        "repo-ingestion": repoQueue,
        compaction: compactionQueue,
      };

      const queue = queues[queueName];
      if (!queue) {
        return reply.code(404).send({ error: "Queue not found" });
      }

      const job = await queue.getJob(jobId);
      if (!job) {
        return reply.code(404).send({ error: "Job not found" });
      }

      const state = await job.getState();

      // Sanitize job data — strip potentially sensitive fields
      const safeData = { ...job.data } as Record<string, unknown>;
      const SENSITIVE_KEYS = ['apiKey', 'api_key', 'token', 'secret', 'password', 'accessToken', 'auth_key', 'credentials'];
      for (const key of SENSITIVE_KEYS) {
        if (key in safeData) safeData[key] = '[REDACTED]';
      }

      return {
        data: {
          id: job.id,
          name: job.name,
          state,
          data: safeData,
          progress: job.progress,
          attemptsMade: job.attemptsMade,
          timestamp: job.timestamp,
          finishedOn: job.finishedOn,
          failedReason: job.failedReason,
        },
      };
    }
  );

    // DELETE /jobs/:queueName/:jobId — cancel job (admin only)
  fastify.delete(
    "/jobs/:queueName/:jobId",
    { preHandler: fastifyRequireAdmin },
    async (request, reply) => {
      const { queueName, jobId } = request.params as { queueName: string; jobId: string };
      const queues: Record<string, typeof ingestionQueue> = {
        ingestion: ingestionQueue,
        research: researchQueue,
        "repo-ingestion": repoQueue,
        compaction: compactionQueue,
      };

      const queue = queues[queueName];
      if (!queue) {
        return reply.code(404).send({ error: "Queue not found" });
      }

      const job = await queue.getJob(jobId);
      if (!job) {
        return reply.code(404).send({ error: "Job not found" });
      }

      const state = await job.getState();
      if (state === "active") {
        await job.moveToFailed(new Error("Cancelled by admin"), "0");
      } else if (state === "waiting" || state === "delayed") {
        await job.remove();
      } else {
        return reply.code(400).send({ error: `Cannot cancel job in '${state}' state` });
      }

      return { message: "Job cancelled", jobId: job.id, previousState: state };
    }
  );
};

export default queuePlugin;
