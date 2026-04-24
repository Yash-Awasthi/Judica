/**
 * Monitoring Worker — metrics collection, health checks, stale job cleanup.
 * Singleton concurrency (1). Runs periodic maintenance tasks.
 */

import { Worker } from "bullmq";
import { BASE_WORKER_OPTIONS, WORKER_CONFIGS } from "./base.config.js";
import { SPECIALIZED_QUEUES } from "../specializedQueues.js";
import { queueWaitingJobs, queueActiveJobs } from "../../lib/prometheusMetrics.js";
import logger from "../../lib/logger.js";

const log = logger.child({ worker: "monitoring" });
const config = WORKER_CONFIGS.monitoring;

export function createMonitoringWorker(): Worker {
  return new Worker(
    "monitoring",
    async (job) => {
      switch (job.name) {
        case "collect-metrics": {
          // Scrape all queue depths and report to Prometheus
          for (const [name, queue] of Object.entries(SPECIALIZED_QUEUES)) {
            try {
              const waiting = await queue.getWaitingCount();
              const active = await queue.getActiveCount();
              queueWaitingJobs.set({ queue: name }, waiting);
              queueActiveJobs.set({ queue: name }, active);
            } catch {
              // best-effort metrics
            }
          }
          break;
        }
        case "cleanup-stale-jobs": {
          log.info("Cleaning up stale jobs");
          for (const [name, queue] of Object.entries(SPECIALIZED_QUEUES)) {
            try {
              const staleJobs = await queue.getJobs(["failed"], 0, 1000);
              const oneWeekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
              let removed = 0;
              for (const staleJob of staleJobs) {
                if (staleJob.timestamp < oneWeekAgo) {
                  await staleJob.remove();
                  removed++;
                }
              }
              if (removed > 0) {
                log.info({ queue: name, removed }, "Removed stale failed jobs");
              }
            } catch {
              // best-effort cleanup
            }
          }
          break;
        }
        case "health-check": {
          log.debug("Worker health check — all workers alive");
          break;
        }
        default:
          log.warn({ jobName: job.name }, "Unknown monitoring job type");
      }
    },
    {
      ...BASE_WORKER_OPTIONS,
      concurrency: config.concurrency,
      lockDuration: config.lockDuration,
    },
  );
}
