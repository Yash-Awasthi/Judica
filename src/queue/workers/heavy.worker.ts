/**
 * Heavy Worker — low concurrency (2) for long-running embedding,
 * indexing, pruning, and reranking operations.
 */

import { Worker } from "bullmq";
import { BASE_WORKER_OPTIONS, WORKER_CONFIGS } from "./base.config.js";
import logger from "../../lib/logger.js";

const log = logger.child({ worker: "heavy" });
const config = WORKER_CONFIGS.heavy;

export function createHeavyWorker(): Worker {
  return new Worker(
    "heavy",
    async (job) => {
      switch (job.name) {
        case "memory-compaction": {
          log.info({ userId: job.data.userId }, "Running memory compaction");
          const { compact } = await import("../../services/memoryCompaction.service.js");
          await compact(job.data.userId);
          break;
        }
        case "research": {
          log.info({ researchJobId: job.data.jobId }, "Running research task");
          const { runResearch } = await import("../../services/research.service.js");
          await runResearch(job.data.jobId, job.data.userId, job.data.query);
          break;
        }
        case "repo-ingestion": {
          log.info({ owner: job.data.owner, repo: job.data.repo }, "Ingesting repo");
          const { ingestGitHubRepo } = await import("../../services/repoIngestion.service.js");
          await ingestGitHubRepo(job.data.userId, job.data.owner, job.data.repo);
          break;
        }
        case "full-reindex": {
          log.info({ kbId: job.data.kbId }, "Running full KB reindex");
          // Placeholder for full reindex logic
          break;
        }
        default:
          log.warn({ jobName: job.name }, "Unknown heavy job type");
      }
    },
    {
      ...BASE_WORKER_OPTIONS,
      concurrency: config.concurrency,
      lockDuration: config.lockDuration,
    },
  );
}
