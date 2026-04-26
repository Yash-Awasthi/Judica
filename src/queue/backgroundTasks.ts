/**
 * Continuous Background Tasks — Phase 4.5
 *
 * BullMQ-backed scheduled/recurring build tasks.
 * Agents can register repeatable jobs that fire on a cron schedule,
 * automatically creating BuildTask entries for council members to pick up.
 *
 * Inspired by:
 * - BullMQ repeatable jobs (taskforcesh/bullmq, 16k stars)
 * - Trigger.dev / Inngest event-driven background jobs
 */

import { Queue, Worker } from "bullmq";
import connection from "./connection.js";
import { db } from "../lib/drizzle.js";
import { buildTasks } from "../db/schema/buildTasks.js";
import logger from "../lib/logger.js";

// ─── Queue ───────────────────────────────────────────────────────────────────

const defaultJobOptions = {
  attempts: 3,
  backoff: { type: "exponential" as const, delay: 5000 },
  removeOnComplete: { count: 200 },
  removeOnFail: { count: 500 },
};

/** Background task queue — scheduled recurring build task creation */
export const backgroundTaskQueue = new Queue("background-tasks", {
  connection,
  defaultJobOptions,
});

// ─── Job types ────────────────────────────────────────────────────────────────

export interface BackgroundTaskJobData {
  userId: number;
  title: string;
  description?: string;
  /** Optional parent task id */
  parentId?: number;
  /** Which agent archetype should claim this task */
  targetAgentId?: string;
  meta?: Record<string, unknown>;
}

// ─── Worker ──────────────────────────────────────────────────────────────────

let workerInstance: Worker | null = null;

export function startBackgroundTaskWorker(): Worker {
  if (workerInstance) return workerInstance;

  workerInstance = new Worker<BackgroundTaskJobData>(
    "background-tasks",
    async (job) => {
      const { userId, title, description, parentId, targetAgentId, meta } = job.data;
      logger.info({ jobId: job.id, userId, title }, "background-task: creating build task");

      const [task] = await db
        .insert(buildTasks)
        .values({
          userId,
          title,
          description: description ?? null,
          parentId: parentId ?? null,
          meta: {
            ...(meta ?? {}),
            scheduledJobId: job.id,
            scheduledAt: new Date().toISOString(),
          },
        })
        .returning();

      // If a target agent is specified, auto-claim the task
      if (targetAgentId && task) {
        // Direct update on just-created task (no race: we own this task)
        await db
          .update(buildTasks)
          .set({
            status: "claimed",
            claimedBy: targetAgentId,
            claimedAt: new Date(),
            isLocked: true,
            updatedAt: new Date(),
          });
      }

      logger.info({ taskId: task?.id, title }, "background-task: build task created");
      return { taskId: task?.id };
    },
    {
      connection,
      concurrency: 5,
    },
  );

  workerInstance.on("failed", (job, err) => {
    logger.error({ jobId: job?.id, err: err.message }, "background-task: job failed");
  });

  return workerInstance;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Schedule a one-off delayed background task */
export async function scheduleBackgroundTask(
  data: BackgroundTaskJobData,
  opts: { delay?: number } = {},
) {
  return backgroundTaskQueue.add("run", data, { delay: opts.delay ?? 0 });
}

/** Register a recurring background task via cron pattern */
export async function registerRecurringTask(
  jobName: string,
  data: BackgroundTaskJobData,
  cron: string,
) {
  return backgroundTaskQueue.add(jobName, data, {
    repeat: { pattern: cron },
  });
}

/** Remove a repeatable task by job name */
export async function removeRecurringTask(jobName: string) {
  const repeatableJobs = await backgroundTaskQueue.getRepeatableJobs();
  const job = repeatableJobs.find((j) => j.name === jobName);
  if (job) {
    await backgroundTaskQueue.removeRepeatableByKey(job.key);
    return true;
  }
  return false;
}

/** List all active repeatable tasks */
export async function listRepeatableJobs() {
  return backgroundTaskQueue.getRepeatableJobs();
}
