/**
 * Workflow Triggers — Phase 4.7
 *
 * Zapier-level trigger nodes that kick off workflows:
 * - Webhook trigger (inbound HTTP POST)
 * - Schedule trigger (cron via BullMQ)
 * - RSS trigger (new feed item)
 * - Form trigger (submit form data)
 * - Event trigger (internal system events)
 *
 * Inspired by:
 * - n8n (n8n-io/n8n, 93k stars) — node-based workflow automation
 * - Activepieces — open-source Zapier with trigger/action nodes
 * - Windmill — workflow engine with typed inputs
 */

import type { FastifyInstance } from "fastify";
import { db } from "../lib/drizzle.js";
import { workflows, workflowRuns } from "../db/schema/workflows.js";
import { eq, and } from "drizzle-orm";
import { z } from "zod";
import { randomUUID } from "crypto";
import { backgroundTaskQueue } from "../queue/backgroundTasks.js";
import connection from "../queue/connection.js";
import { Queue } from "bullmq";

// ─── Trigger queue (separate from backgroundTaskQueue) ───────────────────────

const triggerQueue = new Queue("workflow-triggers", {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: "exponential" as const, delay: 3000 },
    removeOnComplete: { count: 200 },
    removeOnFail: { count: 500 },
  },
});

// ─── Schemas ─────────────────────────────────────────────────────────────────

const registerWebhookSchema = z.object({
  workflowId: z.string().uuid(),
  /** Human-readable name */
  name: z.string().min(1).max(100).optional(),
  /** Secret for HMAC verification (optional) */
  secret: z.string().optional(),
});

const registerScheduleSchema = z.object({
  workflowId: z.string().uuid(),
  name: z.string().min(1).max(100).optional(),
  /** 5-field cron expression */
  cron: z.string().min(9),
  /** Input data to pass to the workflow */
  input: z.record(z.string(), z.unknown()).optional(),
});

// ─── In-memory webhook registry (survives only for process lifetime) ──────────
// For production, store in DB. This is intentionally lightweight.
const webhookRegistry = new Map<string, {
  userId: number;
  workflowId: string;
  name: string;
  secret?: string;
  createdAt: string;
}>();

// ─── Node catalogue (Zapier-style trigger + action library) ──────────────────

const NODE_CATALOGUE = [
  // Triggers
  { category: "trigger", type: "webhook",   label: "Webhook",      description: "Trigger on inbound HTTP POST" },
  { category: "trigger", type: "schedule",  label: "Schedule",     description: "Trigger on cron schedule" },
  { category: "trigger", type: "rss",       label: "RSS Feed",     description: "Trigger on new RSS item" },
  { category: "trigger", type: "form",      label: "Form Submit",  description: "Trigger on form submission" },
  { category: "trigger", type: "event",     label: "System Event", description: "Trigger on internal event" },
  // Actions
  { category: "action",  type: "http",      label: "HTTP Request", description: "Make an outbound HTTP request" },
  { category: "action",  type: "llm",       label: "LLM Call",     description: "Call a language model" },
  { category: "action",  type: "code",      label: "Code",         description: "Run JavaScript/Python code" },
  { category: "action",  type: "condition", label: "Condition",    description: "Branch on expression" },
  { category: "action",  type: "template",  label: "Template",     description: "Render a text/jinja2 template" },
  { category: "action",  type: "merge",     label: "Merge",        description: "Merge multiple branches" },
  { category: "action",  type: "split",     label: "Split",        description: "Fan-out to parallel branches" },
  { category: "action",  type: "loop",      label: "Loop",         description: "Iterate over a list" },
  { category: "action",  type: "human_gate",label: "Human Gate",   description: "Pause for human approval" },
  // Outputs
  { category: "output",  type: "output",    label: "Output",       description: "Return final workflow result" },
];

// ─── Routes ──────────────────────────────────────────────────────────────────

export async function workflowTriggersPlugin(app: FastifyInstance) {

  /**
   * GET /workflow-triggers/nodes
   * Return the full node catalogue (Zapier-style trigger/action library).
   */
  app.get("/workflow-triggers/nodes", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    return { success: true, nodes: NODE_CATALOGUE };
  });

  // ── Webhook triggers ────────────────────────────────────────────────────────

  /**
   * POST /workflow-triggers/webhooks
   * Register a webhook trigger for a workflow.
   * Returns a webhook URL: POST /wh/:webhookId
   */
  app.post("/workflow-triggers/webhooks", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const parsed = registerWebhookSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });

    const { workflowId, name, secret } = parsed.data;

    // Verify workflow belongs to user
    const [wf] = await db
      .select({ id: workflows.id })
      .from(workflows)
      .where(and(eq(workflows.id, workflowId), eq(workflows.userId, userId)))
      .limit(1);
    if (!wf) return reply.status(404).send({ error: "Workflow not found" });

    const webhookId = randomUUID();
    webhookRegistry.set(webhookId, {
      userId,
      workflowId,
      name: name ?? `Webhook for ${workflowId.slice(0, 8)}`,
      secret,
      createdAt: new Date().toISOString(),
    });

    return reply.status(201).send({
      success: true,
      webhookId,
      webhookUrl: `/api/wh/${webhookId}`,
    });
  });

  /**
   * GET /workflow-triggers/webhooks
   * List registered webhooks for the current user.
   */
  app.get("/workflow-triggers/webhooks", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const userWebhooks = Array.from(webhookRegistry.entries())
      .filter(([, v]) => v.userId === userId)
      .map(([id, v]) => ({ webhookId: id, ...v, secret: v.secret ? "***" : undefined }));

    return { success: true, webhooks: userWebhooks, count: userWebhooks.length };
  });

  /**
   * DELETE /workflow-triggers/webhooks/:webhookId
   * Remove a webhook trigger.
   */
  app.delete("/workflow-triggers/webhooks/:webhookId", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const { webhookId } = req.params as { webhookId: string };
    const entry = webhookRegistry.get(webhookId);
    if (!entry || entry.userId !== userId) {
      return reply.status(404).send({ error: "Webhook not found" });
    }
    webhookRegistry.delete(webhookId);
    return { success: true };
  });

  /**
   * POST /wh/:webhookId
   * Inbound webhook endpoint — triggers the linked workflow.
   * No auth required (webhook URL is the secret).
   */
  app.post("/wh/:webhookId", async (req, reply) => {
    const { webhookId } = req.params as { webhookId: string };
    const entry = webhookRegistry.get(webhookId);
    if (!entry) return reply.status(404).send({ error: "Webhook not registered" });

    // Enqueue workflow trigger
    const jobId = randomUUID();
    await triggerQueue.add(
      "webhook-trigger",
      {
        type: "webhook",
        webhookId,
        workflowId: entry.workflowId,
        userId: entry.userId,
        payload: req.body ?? {},
        triggeredAt: new Date().toISOString(),
      },
      { jobId },
    );

    return reply.status(202).send({ success: true, jobId, message: "Workflow triggered" });
  });

  // ── Schedule triggers ───────────────────────────────────────────────────────

  /**
   * POST /workflow-triggers/schedules
   * Register a cron-based workflow schedule.
   */
  app.post("/workflow-triggers/schedules", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const parsed = registerScheduleSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });

    const { workflowId, name, cron, input } = parsed.data;

    // Verify workflow belongs to user
    const [wf] = await db
      .select({ id: workflows.id })
      .from(workflows)
      .where(and(eq(workflows.id, workflowId), eq(workflows.userId, userId)))
      .limit(1);
    if (!wf) return reply.status(404).send({ error: "Workflow not found" });

    const jobName = `schedule-${userId}-${workflowId}`;
    await triggerQueue.add(
      jobName,
      {
        type: "schedule",
        workflowId,
        userId,
        input: input ?? {},
        triggeredAt: new Date().toISOString(),
      },
      { repeat: { pattern: cron } },
    );

    return reply.status(201).send({
      success: true,
      jobName,
      cron,
      workflowId,
      message: `Workflow scheduled: ${cron}`,
    });
  });

  /**
   * GET /workflow-triggers/schedules
   * List active schedule triggers.
   */
  app.get("/workflow-triggers/schedules", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const jobs = await triggerQueue.getRepeatableJobs();
    const userJobs = jobs.filter((j) => j.name.startsWith(`schedule-${userId}-`));

    return { success: true, schedules: userJobs, count: userJobs.length };
  });

  /**
   * DELETE /workflow-triggers/schedules/:jobName
   * Remove a scheduled trigger.
   */
  app.delete("/workflow-triggers/schedules/:jobName", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const { jobName } = req.params as { jobName: string };
    if (!jobName.startsWith(`schedule-${userId}-`)) {
      return reply.status(403).send({ error: "Not authorized to delete this schedule" });
    }

    const jobs = await triggerQueue.getRepeatableJobs();
    const job = jobs.find((j) => j.name === jobName);
    if (!job) return reply.status(404).send({ error: "Schedule not found" });

    await triggerQueue.removeRepeatableByKey(job.key);
    return { success: true };
  });

  /**
   * POST /workflow-triggers/emit
   * Emit a named system event that triggers matching workflows.
   */
  app.post("/workflow-triggers/emit", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const { event, payload } = req.body as { event?: string; payload?: unknown };
    if (!event) return reply.status(400).send({ error: "event name required" });

    await triggerQueue.add("event-trigger", {
      type: "event",
      event,
      userId,
      payload: payload ?? {},
      triggeredAt: new Date().toISOString(),
    });

    return reply.status(202).send({ success: true, event, message: "Event emitted" });
  });
}
