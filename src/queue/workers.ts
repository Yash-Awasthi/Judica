import { Worker, Job } from "bullmq";
import connection from "./connection.js";
import { deadLetterQueue, ingestionQueue, researchQueue, repoQueue, compactionQueue } from "./queues.js";
import logger from "../lib/logger.js";
import { queueJobLag, queueWaitingJobs, queueActiveJobs } from "../lib/prometheusMetrics.js";

let ingestionWorker: Worker;
let repoWorker: Worker;
let compactionWorker: Worker;
let researchWorker: Worker;
let autoscaleInterval: ReturnType<typeof setInterval>;

/**
 * Move a permanently failed job to the dead-letter queue for manual inspection.
 */
async function moveToDeadLetterQueue(job: Job | undefined, err: Error, queueName: string) {
  if (!job) return;

  // Only move to DLQ when all retry attempts are exhausted
  if (job.attemptsMade < (job.opts.attempts ?? 3)) return;

  try {
    await deadLetterQueue.add("dead-letter", {
      originalQueue: queueName,
      originalJobId: job.id,
      originalJobName: job.name,
      data: job.data,
      failedReason: err.message,
      stackTrace: job.stacktrace,
      attemptsMade: job.attemptsMade,
      failedAt: new Date().toISOString(),
    });
    logger.warn(
      { jobId: job.id, queue: queueName, attempts: job.attemptsMade },
      "Job moved to dead-letter queue after exhausting retries",
    );
  } catch (dlqErr) {
    logger.error(
      { jobId: job.id, queue: queueName, err: dlqErr },
      "Failed to move job to dead-letter queue",
    );
  }
}

export function startWorkers() {
  ingestionWorker = new Worker(
    "ingestion",
    async (job) => {
      logger.info({ jobId: job.id, userId: job.data?.userId, kbId: job.data?.kbId }, "Processing KB ingestion job");
      const { storeChunk } = await import("../services/vectorStore.service.js");
      const { userId, kbId, content, chunkIndex, sourceName, sourceUrl } = job.data;
      await storeChunk(userId, kbId, content, chunkIndex, sourceName, sourceUrl);
      logger.info({ jobId: job.id }, "KB ingestion job completed");
    },
    { connection, concurrency: 5 }
  );

  repoWorker = new Worker(
    "repo-ingestion",
    async (job) => {
      logger.info({ jobId: job.id, userId: job.data?.userId, owner: job.data?.owner, repo: job.data?.repo }, "Processing repo ingestion job");
      const { ingestGitHubRepo } = await import("../services/repoIngestion.service.js");
      const { userId, owner, repo } = job.data;
      await ingestGitHubRepo(userId, owner, repo);
      logger.info({ jobId: job.id }, "Repo ingestion job completed");
    },
    { connection, concurrency: 2 }
  );

  researchWorker = new Worker(
    "research",
    async (job) => {
      logger.info({ jobId: job.id, userId: job.data?.userId }, "Processing research job");
      const { runResearch } = await import("../services/research.service.js");
      const { jobId, userId, query } = job.data;
      await runResearch(jobId, userId, query);
      logger.info({ jobId: job.id }, "Research job completed");
    },
    { connection, concurrency: 2 }
  );

  compactionWorker = new Worker(
    "compaction",
    async (job) => {
      logger.info({ jobId: job.id, userId: job.data?.userId }, "Processing memory compaction job");
      const { compact } = await import("../services/memoryCompaction.service.js");
      const { userId } = job.data;
      await compact(userId);
      logger.info({ jobId: job.id }, "Memory compaction job completed");
    },
    { connection, concurrency: 1 }
  );

  const workers = [ingestionWorker, repoWorker, researchWorker, compactionWorker];
  for (const worker of workers) {
    worker.on("failed", (job, err) => {
      logger.error(
        { jobId: job?.id, queue: worker.name, err, attempt: job?.attemptsMade },
        "Worker job failed",
      );
      void moveToDeadLetterQueue(job, err, worker.name);
    });
    worker.on("completed", (job) => {
      logger.info({ jobId: job?.id, queue: worker.name }, "Worker job completed");
    });

    // P4-16: Track job lag (time spent waiting in queue before pickup)
    worker.on("active", (job) => {
      if (job?.processedOn && job?.timestamp) {
        const lagMs = job.processedOn - job.timestamp;
        queueJobLag.observe({ queue: worker.name }, lagMs / 1000);
      }
    });
  }

  // P4-16: Periodically scrape queue depths for autoscaling signals
  autoscaleInterval = setInterval(async () => {
    const queues = [
      { name: "ingestion", q: ingestionQueue },
      { name: "repo-ingestion", q: repoQueue },
      { name: "research", q: researchQueue },
      { name: "compaction", q: compactionQueue },
    ];
    for (const { name, q } of queues) {
      try {
        const waiting = await q.getWaitingCount();
        const active = await q.getActiveCount();
        queueWaitingJobs.set({ queue: name }, waiting);
        queueActiveJobs.set({ queue: name }, active);
      } catch {
        // best-effort metrics
      }
    }
  }, 15_000); // every 15s

  logger.info("BullMQ workers started (ingestion, repo, research, compaction)");
}

export async function stopWorkers() {
  if (autoscaleInterval) clearInterval(autoscaleInterval);
  const workers = [ingestionWorker, repoWorker, researchWorker, compactionWorker].filter(Boolean);
  await Promise.all(workers.map((w) => w.close()));
  logger.info("BullMQ workers stopped");
}
