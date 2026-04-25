/**
 * Light Worker — high concurrency (20) for fast metadata syncs,
 * permission updates, ACL refreshes, and lightweight tasks.
 */

import { Worker } from "bullmq";
import { BASE_WORKER_OPTIONS, WORKER_CONFIGS } from "./base.config.js";
import logger from "../../lib/logger.js";

const log = logger.child({ worker: "light" });
const config = WORKER_CONFIGS.light;

export function createLightWorker(): Worker {
  return new Worker(
    "light",
    async (job) => {
      switch (job.name) {
        case "permission-sync":
        case "connector-acl-refresh": {
          log.info({ connectorId: job.data.connectorId }, "Syncing connector permissions");
          const { syncConnectorPermissions } = await import("../../services/permissionSync.service.js");
          const result = await syncConnectorPermissions(job.data.connectorId as string);
          log.info({ connectorId: job.data.connectorId, ...result }, "Permission sync done");
          break;
        }
        case "update-acl": {
          log.info({ kbId: job.data.kbId, sourceName: job.data.sourceName }, "Updating ACL");
          // ACL update — requires document-acls branch to be merged
          // Uses: updateDocumentAcl(kbId, sourceName, acl)
          break;
        }
        case "update-boost": {
          log.info({ kbId: job.data.kbId }, "Updating document boost");
          // Boost update — requires document-acls branch to be merged
          // Uses: updateDocumentBoost(kbId, sourceName, boostFactor)
          break;
        }
        case "metadata-refresh": {
          log.info({ docId: job.data.docId }, "Refreshing document metadata");
          break;
        }
        default:
          log.warn({ jobName: job.name }, "Unknown light job type");
      }
    },
    {
      ...BASE_WORKER_OPTIONS,
      concurrency: config.concurrency,
      lockDuration: config.lockDuration,
    },
  );
}
