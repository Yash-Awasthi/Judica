import { FastifyPluginAsync, FastifyRequest, FastifyReply } from "fastify";
import { fastifyRequireAuth } from "../middleware/fastifyAuth.js";
import { ingestionQueue, researchQueue, repoQueue, compactionQueue } from "../queue/queues.js";
import { db } from "../lib/drizzle.js";
import { users } from "../db/schema/users.js";
import { eq } from "drizzle-orm";

function fastifyRequireRole(...roles: string[]) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    // First ensure authenticated
    await fastifyRequireAuth(request, reply);
    if (reply.sent) return;

    if (!request.userId) {
      reply.code(401).send({ error: "Not authenticated" });
      return;
    }

    const [user] = await db
      .select({ role: users.role })
      .from(users)
      .where(eq(users.id, request.userId))
      .limit(1);

    if (!user || !roles.includes(user.role)) {
      reply.code(403).send({ error: "Insufficient permissions" });
      return;
    }
  };
}

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
  fastify.get("/stats", { onRequest: fastifyRequireRole("admin") }, async (_request, _reply) => {
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
    { preHandler: fastifyRequireRole("admin") },
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
      return {
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
      };
    }
  );

    // DELETE /jobs/:queueName/:jobId — cancel job (admin only)
  fastify.delete(
    "/jobs/:queueName/:jobId",
    { preHandler: fastifyRequireRole("admin") },
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
