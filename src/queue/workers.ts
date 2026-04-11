import { Worker } from "bullmq";
import connection from "./connection.js";
import logger from "../lib/logger.js";

let ingestionWorker: Worker;
let repoWorker: Worker;
let compactionWorker: Worker;
let researchWorker: Worker;

export function startWorkers() {
  ingestionWorker = new Worker(
    "ingestion",
    async (job) => {
      logger.info({ jobId: job.id, data: job.data }, "Processing KB ingestion job");
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
      logger.info({ jobId: job.id, data: job.data }, "Processing repo ingestion job");
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
      logger.info({ jobId: job.id, data: job.data }, "Processing research job");
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
      logger.info({ jobId: job.id, data: job.data }, "Processing memory compaction job");
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
      logger.error({ jobId: job?.id, queue: worker.name, err }, "Worker job failed");
    });
    worker.on("completed", (job) => {
      logger.info({ jobId: job?.id, queue: worker.name }, "Worker job completed");
    });
  }

  logger.info("BullMQ workers started (ingestion, repo, research, compaction)");
}

export async function stopWorkers() {
  const workers = [ingestionWorker, repoWorker, researchWorker, compactionWorker].filter(Boolean);
  await Promise.all(workers.map((w) => w.close()));
  logger.info("BullMQ workers stopped");
}
