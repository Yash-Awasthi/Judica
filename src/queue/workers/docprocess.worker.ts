/**
 * Doc-Process Worker — CPU-bound chunking + embedding generation.
 * Low-medium concurrency (4) to avoid overwhelming the embedding API.
 */

import { Worker } from "bullmq";
import { BASE_WORKER_OPTIONS, WORKER_CONFIGS } from "./base.config.js";
import logger from "../../lib/logger.js";

const log = logger.child({ worker: "docprocess" });
const config = WORKER_CONFIGS.docprocess;

export function createDocprocessWorker(): Worker {
  return new Worker(
    "docprocess",
    async (job) => {
      switch (job.name) {
        case "chunk-and-embed": {
          log.info({ docId: job.data.docId, sourceName: job.data.sourceName }, "Chunking + embedding document");
          const { ingestDocument } = await import("../../services/ingestion.service.js");
          await ingestDocument(
            job.data.userId,
            job.data.kbId,
            job.data.docId,
            job.data.sourceName,
            job.data.content,
          );
          break;
        }
        case "reindex-kb": {
          log.info({ kbId: job.data.kbId }, "Reindexing knowledge base");
          // Placeholder for KB reindex logic
          break;
        }
        case "re-embed": {
          log.info({ chunkId: job.data.chunkId }, "Re-embedding chunk");
          // Placeholder for re-embedding with updated model
          break;
        }
        default:
          log.warn({ jobName: job.name }, "Unknown docprocess job type");
      }
    },
    {
      ...BASE_WORKER_OPTIONS,
      concurrency: config.concurrency,
      lockDuration: config.lockDuration,
    },
  );
}
