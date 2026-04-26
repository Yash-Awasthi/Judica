/**
 * Background Tasks API routes — Phase 4.5
 *
 * Schedule one-off or recurring build tasks using BullMQ.
 * Recurring tasks use cron patterns (standard 5-field cron).
 *
 * Inspired by BullMQ repeatable jobs + Trigger.dev scheduled tasks.
 */

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  scheduleBackgroundTask,
  registerRecurringTask,
  removeRecurringTask,
  listRepeatableJobs,
  backgroundTaskQueue,
} from "../queue/backgroundTasks.js";

const scheduleSchema = z.object({
  title:         z.string().min(1).max(500),
  description:   z.string().optional(),
  parentId:      z.number().optional(),
  targetAgentId: z.string().optional(),
  /** Delay in ms for one-off tasks (default: 0 = immediate) */
  delay:         z.number().min(0).optional(),
  meta:          z.record(z.string(), z.unknown()).optional(),
});

const recurringSchema = z.object({
  jobName:       z.string().min(1).max(100),
  title:         z.string().min(1).max(500),
  description:   z.string().optional(),
  parentId:      z.number().optional(),
  targetAgentId: z.string().optional(),
  /** Standard 5-field cron expression */
  cron:          z.string().min(9),
  meta:          z.record(z.string(), z.unknown()).optional(),
});

export async function backgroundTasksPlugin(app: FastifyInstance) {
  /**
   * POST /background-tasks/schedule
   * Schedule a one-off background task (immediate or delayed).
   */
  app.post("/background-tasks/schedule", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const parsed = scheduleSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });

    const { delay, ...data } = parsed.data;
    const job = await scheduleBackgroundTask({ userId, ...data }, { delay });

    return reply.status(202).send({
      success: true,
      jobId: job.id,
      message: delay ? `Task scheduled with ${delay}ms delay` : "Task queued immediately",
    });
  });

  /**
   * POST /background-tasks/recurring
   * Register a recurring cron-based background task.
   */
  app.post("/background-tasks/recurring", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const parsed = recurringSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });

    const { jobName, cron, ...data } = parsed.data;
    await registerRecurringTask(jobName, { userId, ...data }, cron);

    return reply.status(201).send({
      success: true,
      jobName,
      cron,
      message: `Recurring task "${jobName}" registered with cron: ${cron}`,
    });
  });

  /**
   * DELETE /background-tasks/recurring/:jobName
   * Remove a registered recurring task.
   */
  app.delete("/background-tasks/recurring/:jobName", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const { jobName } = req.params as { jobName: string };
    const removed = await removeRecurringTask(jobName);

    if (!removed) return reply.status(404).send({ error: "Recurring task not found" });
    return { success: true, removed: jobName };
  });

  /**
   * GET /background-tasks/recurring
   * List all registered recurring tasks.
   */
  app.get("/background-tasks/recurring", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const jobs = await listRepeatableJobs();
    return { success: true, jobs, count: jobs.length };
  });

  /**
   * GET /background-tasks/stats
   * Queue stats: waiting, active, completed, failed counts.
   */
  app.get("/background-tasks/stats", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const [waiting, active, completed, failed] = await Promise.all([
      backgroundTaskQueue.getWaitingCount(),
      backgroundTaskQueue.getActiveCount(),
      backgroundTaskQueue.getCompletedCount(),
      backgroundTaskQueue.getFailedCount(),
    ]);

    return { success: true, stats: { waiting, active, completed, failed } };
  });
}
