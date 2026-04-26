/**
 * Reactive Event-Driven Agents — Phase 4.15
 *
 * Agents react to system events (new message, task created, KB updated, etc.)
 * with configurable event→handler mappings. Handlers run asynchronously
 * via BullMQ, enabling durable, retryable event processing.
 *
 * Architecture:
 * - EventBus: in-memory pub/sub (fast)
 * - Reaction rules: userId → event pattern → handler config
 * - BullMQ queue: durable async execution for heavy handlers
 *
 * Inspired by:
 * - Inngest (inngest/inngest, 4k stars) — event-driven function platform
 * - Trigger.dev (triggerdotdev/trigger.dev) — background jobs from events
 * - BullMQ event queues (taskforcesh/bullmq)
 */

import type { FastifyInstance } from "fastify";
import { Queue } from "bullmq";
import connection from "../queue/connection.js";
import { z } from "zod";
import { randomUUID } from "crypto";
import logger from "../lib/logger.js";
import { askProvider } from "../lib/providers.js";
import { env } from "../config/env.js";

// ─── Event queue ─────────────────────────────────────────────────────────────

const reactiveQueue = new Queue("reactive-agents", {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: "exponential" as const, delay: 3000 },
    removeOnComplete: { count: 200 },
    removeOnFail: { count: 500 },
  },
});

// ─── Types ────────────────────────────────────────────────────────────────────

type HandlerType =
  | "llm_response"     // Run an LLM prompt and log the result
  | "webhook"          // POST to a URL
  | "create_task"      // Create a build task
  | "notify"           // Push notification (stub)
  | "chain_event";     // Emit another event

interface ReactionRule {
  id: string;
  userId: number;
  /** Glob-style event pattern (e.g. "task.*", "message.created") */
  eventPattern: string;
  /** Human-readable name */
  name: string;
  handler: {
    type: HandlerType;
    config: Record<string, unknown>;
  };
  isActive: boolean;
  /** Number of times this rule has fired */
  fireCount: number;
  createdAt: string;
  updatedAt: string;
}

interface EventRecord {
  id: string;
  event: string;
  userId: number;
  payload: Record<string, unknown>;
  matchedRules: string[];
  processedAt: string;
}

// ─── In-memory stores ─────────────────────────────────────────────────────────

const reactionRules = new Map<string, ReactionRule>();
const eventHistory  = new Map<string, EventRecord>();

// ─── Pattern matching ─────────────────────────────────────────────────────────

function matchesPattern(event: string, pattern: string): boolean {
  if (pattern === "*") return true;
  if (pattern === event) return true;
  // Convert glob to regex: * matches any segment
  // Escape all regex metacharacters first, then restore the glob wildcard
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^.]+");
  const regex = new RegExp("^" + escaped + "$");
  return regex.test(event);
}

// ─── Handler execution ────────────────────────────────────────────────────────

async function executeHandler(
  rule: ReactionRule,
  event: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const { type, config } = rule.handler;
  logger.info({ ruleId: rule.id, event, handlerType: type }, "reactive-agent: executing handler");

  try {
    switch (type) {
      case "llm_response": {
        const prompt = (config.prompt as string ?? "Event {event} occurred: {payload}")
          .replace("{event}", event)
          .replace("{payload}", JSON.stringify(payload).slice(0, 500));
        const provider = {
          name: "openai",
          type: "api" as const,
          apiKey: env.OPENAI_API_KEY ?? "",
          model: (config.model as string) ?? "gpt-4o-mini",
          systemPrompt: (config.systemPrompt as string) ?? "You are a reactive AI agent.",
        };
        const res = await askProvider(provider, [{ role: "user", content: prompt }]);
        logger.info({ ruleId: rule.id, response: res.text.slice(0, 100) }, "reactive-agent: LLM response");
        break;
      }

      case "webhook": {
        const url = config.url as string;
        if (!url) { logger.warn("reactive-agent: webhook handler missing url"); break; }
        await fetch(url, {
          method: (config.method as string) ?? "POST",
          headers: { "Content-Type": "application/json", ...(config.headers as Record<string, string> ?? {}) },
          body: JSON.stringify({ event, payload, ruleId: rule.id }),
          signal: AbortSignal.timeout(10000),
        });
        break;
      }

      case "chain_event": {
        const chainEvent = config.event as string;
        if (chainEvent) {
          await reactiveQueue.add("process-event", {
            event: chainEvent,
            userId: rule.userId,
            payload: { ...payload, chainedFrom: event },
          });
        }
        break;
      }

      case "create_task":
        // Enqueue task creation (import happens at runtime to avoid circular deps)
        await reactiveQueue.add("create-task", {
          userId: rule.userId,
          title: (config.title as string ?? `Auto: ${event}`),
          description: (config.description as string),
          meta: { triggeredByEvent: event, payload },
        });
        break;

      case "notify":
        logger.info({ ruleId: rule.id, event }, "reactive-agent: notify (stub — integrate web-push in Phase 4.20)");
        break;
    }
  } catch (err) {
    logger.error({ ruleId: rule.id, event, err: err instanceof Error ? err.message : err }, "reactive-agent: handler failed");
    throw err;
  }
}

// ─── Schemas ─────────────────────────────────────────────────────────────────

const createRuleSchema = z.object({
  name:         z.string().min(1).max(200),
  eventPattern: z.string().min(1).max(100),
  handler: z.object({
    type:   z.enum(["llm_response", "webhook", "create_task", "notify", "chain_event"]),
    config: z.record(z.string(), z.unknown()),
  }),
  isActive:     z.boolean().optional(),
});

const emitEventSchema = z.object({
  event:   z.string().min(1).max(100),
  payload: z.record(z.string(), z.unknown()).optional(),
});

// ─── Routes ──────────────────────────────────────────────────────────────────

export async function reactiveAgentsPlugin(app: FastifyInstance) {

  /**
   * POST /reactions
   * Create a reaction rule.
   */
  app.post("/reactions", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const parsed = createRuleSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });

    const id = randomUUID();
    const now = new Date().toISOString();
    const rule: ReactionRule = {
      id,
      userId,
      ...parsed.data,
      isActive: parsed.data.isActive ?? true,
      fireCount: 0,
      createdAt: now,
      updatedAt: now,
    };
    reactionRules.set(id, rule);

    return reply.status(201).send({ success: true, rule });
  });

  /**
   * GET /reactions
   * List reaction rules for the user.
   */
  app.get("/reactions", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const rules = [...reactionRules.values()]
      .filter((r) => r.userId === userId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

    return { success: true, rules, count: rules.length };
  });

  /**
   * PATCH /reactions/:id
   * Update or toggle a rule.
   */
  app.patch("/reactions/:id", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const { id } = req.params as { id: string };
    const rule = reactionRules.get(id);
    if (!rule || rule.userId !== userId) return reply.status(404).send({ error: "Rule not found" });

    const update = req.body as Partial<ReactionRule>;
    const updated = { ...rule, ...update, id, userId, updatedAt: new Date().toISOString() };
    reactionRules.set(id, updated);

    return { success: true, rule: updated };
  });

  /**
   * DELETE /reactions/:id
   * Remove a rule.
   */
  app.delete("/reactions/:id", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const { id } = req.params as { id: string };
    const rule = reactionRules.get(id);
    if (!rule || rule.userId !== userId) return reply.status(404).send({ error: "Rule not found" });
    reactionRules.delete(id);
    return { success: true };
  });

  /**
   * POST /reactions/emit
   * Emit an event — matches against all active rules and fires handlers.
   */
  app.post("/reactions/emit", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const parsed = emitEventSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });

    const { event, payload = {} } = parsed.data;

    // Find matching active rules
    const matched = [...reactionRules.values()].filter(
      (r) => r.userId === userId && r.isActive && matchesPattern(event, r.eventPattern),
    );

    const eventId = randomUUID();
    const record: EventRecord = {
      id: eventId,
      event,
      userId,
      payload,
      matchedRules: matched.map((r) => r.id),
      processedAt: new Date().toISOString(),
    };
    eventHistory.set(eventId, record);

    // Fire handlers asynchronously
    for (const rule of matched) {
      rule.fireCount++;
      rule.updatedAt = new Date().toISOString();
      executeHandler(rule, event, payload).catch((err) => {
        logger.error({ ruleId: rule.id, err: err.message }, "reactive-agent: async handler error");
      });
    }

    return reply.status(202).send({
      success: true,
      eventId,
      event,
      matchedRules: matched.length,
      ruleIds: matched.map((r) => r.id),
    });
  });

  /**
   * GET /reactions/events
   * Recent event history.
   */
  app.get("/reactions/events", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const events = [...eventHistory.values()]
      .filter((e) => e.userId === userId)
      .sort((a, b) => b.processedAt.localeCompare(a.processedAt))
      .slice(0, 100);

    return { success: true, events, count: events.length };
  });
}
