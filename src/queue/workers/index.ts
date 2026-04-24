/**
 * Specialized Workers — barrel export + lifecycle management.
 * Creates, starts, and stops all 7 specialized worker types.
 */

import type { Worker, Job } from "bullmq";
import { createCoordinatorWorker } from "./coordinator.worker.js";
import { createLightWorker } from "./light.worker.js";
import { createHeavyWorker } from "./heavy.worker.js";
import { createDocfetchWorker } from "./docfetch.worker.js";
import { createDocprocessWorker } from "./docprocess.worker.js";
import { createUserfileWorker } from "./userfile.worker.js";
import { createMonitoringWorker } from "./monitoring.worker.js";
import { deadLetterQueue } from "../queues.js";
import { monitoringQueue } from "../specializedQueues.js";
import { queueJobLag } from "../../lib/prometheusMetrics.js";
import logger from "../../lib/logger.js";

let workers: Worker[] = [];
let metricsInterval: ReturnType<typeof setInterval>;

/**
 * Move a permanently failed job to the dead-letter queue for manual inspection.
 */
async function moveToDeadLetterQueue(job: Job | undefined, err: Error, queueName: string) {
  if (!job) return;
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

/**
 * Start all 7 specialized workers with shared event handling.
 */
export function startSpecializedWorkers() {
  workers = [
    createCoordinatorWorker(),
    createLightWorker(),
    createHeavyWorker(),
    createDocfetchWorker(),
    createDocprocessWorker(),
    createUserfileWorker(),
    createMonitoringWorker(),
  ];

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

    worker.on("active", (job) => {
      if (job?.processedOn && job?.timestamp && Number.isFinite(job.processedOn) && Number.isFinite(job.timestamp)) {
        const lagMs = job.processedOn - job.timestamp;
        if (lagMs >= 0) queueJobLag.observe({ queue: worker.name }, lagMs / 1000);
      }
    });

    worker.run();
  }

  // Schedule periodic metrics collection via monitoring queue
  metricsInterval = setInterval(async () => {
    try {
      await monitoringQueue.add("collect-metrics", {}, {
        jobId: `metrics-${Date.now()}`,
        removeOnComplete: true,
        removeOnFail: true,
      });
    } catch {
      // best-effort
    }
  }, 15_000);

  const workerNames = workers.map((w) => w.name).join(", ");
  logger.info(`Specialized BullMQ workers started: ${workerNames}`);
}

/**
 * Gracefully stop all specialized workers.
 */
export async function stopSpecializedWorkers() {
  if (metricsInterval) clearInterval(metricsInterval);
  await Promise.all(workers.filter(Boolean).map((w) => w.close()));
  workers = [];
  logger.info("Specialized BullMQ workers stopped");
}
