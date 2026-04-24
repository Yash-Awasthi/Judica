/**
 * Coordinator Worker — singleton dispatcher that schedules connector syncs
 * and coordinates heavy tasks. Runs with Redis lock to ensure only one instance.
 */

import { Worker } from "bullmq";
import { BASE_WORKER_OPTIONS, WORKER_CONFIGS } from "./base.config.js";
import { docfetchQueue, docprocessQueue, lightQueue } from "../specializedQueues.js";
import logger from "../../lib/logger.js";

const log = logger.child({ worker: "coordinator" });
const config = WORKER_CONFIGS.coordinator;

export function createCoordinatorWorker(): Worker {
  return new Worker(
    "coordinator",
    async (job) => {
      switch (job.name) {
        case "schedule-connector-syncs": {
          log.info("Checking for connectors due for sync");
          // Dispatch docfetch jobs for each connector due
          // This will be wired up with the connector service
          const connectorIds = job.data.connectorIds as string[] | undefined;
          if (connectorIds) {
            for (const connectorId of connectorIds) {
              await docfetchQueue.add("connector-pull", { connectorId }, {
                priority: 5,
                jobId: `connector-pull-${connectorId}-${Date.now()}`,
              });
            }
            log.info({ count: connectorIds.length }, "Dispatched connector sync jobs");
          }
          break;
        }
        case "dispatch-reindex": {
          log.info({ kbId: job.data.kbId }, "Dispatching reindex jobs");
          await docprocessQueue.add("reindex-kb", { kbId: job.data.kbId }, { priority: 5 });
          break;
        }
        case "dispatch-permission-sync": {
          log.info({ connectorId: job.data.connectorId }, "Dispatching permission sync");
          await lightQueue.add("permission-sync", {
            connectorId: job.data.connectorId,
          }, { priority: 2 });
          break;
        }
        default:
          log.warn({ jobName: job.name }, "Unknown coordinator job type");
      }
    },
    {
      ...BASE_WORKER_OPTIONS,
      concurrency: config.concurrency,
      lockDuration: config.lockDuration,
    },
  );
}
