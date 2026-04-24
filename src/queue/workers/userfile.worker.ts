/**
 * User-File Worker — processes user-uploaded files (PDF, DOCX, XLSX, etc).
 * Medium concurrency (3). Bridges to existing processors/.
 */

import { Worker } from "bullmq";
import { BASE_WORKER_OPTIONS, WORKER_CONFIGS } from "./base.config.js";
import logger from "../../lib/logger.js";

const log = logger.child({ worker: "userfile" });
const config = WORKER_CONFIGS.userfile;

export function createUserfileWorker(): Worker {
  return new Worker(
    "userfile",
    async (job) => {
      switch (job.name) {
        case "process-upload": {
          log.info({ uploadId: job.data.uploadId, filename: job.data.filename }, "Processing uploaded file");
          const { storeChunk } = await import("../../services/vectorStore.service.js");
          const { userId, kbId, content, chunkIndex, sourceName, sourceUrl } = job.data;
          await storeChunk(userId, kbId, content, chunkIndex, sourceName, sourceUrl);
          log.info({ uploadId: job.data.uploadId }, "Upload processing complete");
          break;
        }
        default:
          log.warn({ jobName: job.name }, "Unknown userfile job type");
      }
    },
    {
      ...BASE_WORKER_OPTIONS,
      concurrency: config.concurrency,
      lockDuration: config.lockDuration,
    },
  );
}
