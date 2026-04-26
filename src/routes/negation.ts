/**
 * Perfect Negation Handling — Phase 7.4
 *
 * Routes:
 *   POST /negation/detect          — Detect negation triggers in a message
 *   POST /negation/add             — Extract and add negation rules to a conversation
 *   GET  /negation/:convId         — Get active negation rules for a conversation
 *   DELETE /negation/:convId/:id   — Delete a specific negation rule
 *   DELETE /negation/:convId       — Clear all negation rules for a conversation
 *   POST /negation/inject          — Build the system prompt injection block
 */

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  detectNegationTriggers,
  extractNegationRules,
  addNegationRules,
  getNegationRules,
  deleteNegationRule,
  clearNegationRules,
  buildNegationBlock,
} from "../lib/negationHandler.js";
import { env } from "../config/env.js";

const rewriteProvider = {
  name: "openai" as const,
  type: "api" as const,
  apiKey: env.OPENAI_API_KEY ?? env.ANTHROPIC_API_KEY ?? "",
  model: env.OPENAI_API_KEY ? "gpt-4o-mini" : "claude-3-haiku-20240307",
};

const addSchema = z.object({
  conversationId: z.string().min(1).max(200),
  message:        z.string().min(1).max(10_000),
  /** Use LLM extraction (costs tokens). Default: true */
  useLLM:         z.boolean().optional().default(true),
});

const injectSchema = z.object({
  conversationId: z.string().min(1).max(200),
  systemPrompt:   z.string().max(20_000).optional().default(""),
});

export async function negationPlugin(app: FastifyInstance) {

  app.post("/negation/detect", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const { message } = req.body as { message: string };
    if (!message) return reply.status(400).send({ error: "message required" });

    const triggers = detectNegationTriggers(message);
    return { success: true, triggers, hasNegations: triggers.length > 0 };
  });

  app.post("/negation/add", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const parsed = addSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });

    const { conversationId, message, useLLM } = parsed.data;

    const rules = useLLM
      ? await extractNegationRules(message, rewriteProvider)
      : detectNegationTriggers(message);

    const allRules = await addNegationRules(conversationId, rules, useLLM ? "llm" : "heuristic");

    return { success: true, addedCount: rules.length, totalRules: allRules.length, rules: allRules };
  });

  app.get("/negation/:convId", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const { convId } = req.params as { convId: string };
    const rules = await getNegationRules(convId);
    return { success: true, count: rules.length, rules };
  });

  app.delete("/negation/:convId/:ruleId", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const { convId, ruleId } = req.params as { convId: string; ruleId: string };
    await deleteNegationRule(convId, ruleId);
    return { success: true };
  });

  app.delete("/negation/:convId", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const { convId } = req.params as { convId: string };
    await clearNegationRules(convId);
    return { success: true };
  });

  app.post("/negation/inject", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const parsed = injectSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });

    const { conversationId, systemPrompt } = parsed.data;
    const rules = await getNegationRules(conversationId);
    const block = buildNegationBlock(rules);

    return {
      success:         true,
      ruleCount:       rules.length,
      injectedPrompt:  block + systemPrompt,
      hasInjection:    block.length > 0,
    };
  });
}
