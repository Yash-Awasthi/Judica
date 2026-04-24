/**
 * Doc-Fetch Worker — I/O-bound connector pulls from external APIs.
 * High concurrency (8) since these are mostly waiting on network.
 */

import { Worker } from "bullmq";
import { BASE_WORKER_OPTIONS, WORKER_CONFIGS } from "./base.config.js";
import { docprocessQueue } from "../specializedQueues.js";
import logger from "../../lib/logger.js";

const log = logger.child({ worker: "docfetch" });
const config = WORKER_CONFIGS.docfetch;

export function createDocfetchWorker(): Worker {
  return new Worker(
    "docfetch",
    async (job) => {
      switch (job.name) {
        case "connector-pull": {
          log.info({ connectorId: job.data.connectorId }, "Pulling documents from connector");
          // Fetch documents from external source, then dispatch to docprocess for chunking
          // This will wire to executeConnectorRun from connector.service
          const docs = job.data.documents as Array<{ id: string; content: string; sourceName: string }> | undefined;
          if (docs) {
            for (const doc of docs) {
              await docprocessQueue.add("chunk-and-embed", {
                userId: job.data.userId,
                kbId: job.data.kbId,
                content: doc.content,
                sourceName: doc.sourceName,
                docId: doc.id,
              }, { priority: 5 });
            }
            log.info({ count: docs.length }, "Dispatched docs to docprocess");
          }
          break;
        }
        case "web-crawl": {
          log.info({ url: job.data.url }, "Crawling web page");
          // Placeholder for web crawl + dispatch to docprocess
          break;
        }
        default:
          log.warn({ jobName: job.name }, "Unknown docfetch job type");
      }
    },
    {
      ...BASE_WORKER_OPTIONS,
      concurrency: config.concurrency,
      lockDuration: config.lockDuration,
    },
  );
}
