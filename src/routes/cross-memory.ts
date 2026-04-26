/**
 * Cross-Conversation Memory Sharing — Phase 2.3
 *
 * Exposes cross-session memory retrieval from src/lib/crossConversationMemory.ts.
 * Retrieves relevant memories from past conversations to inject into current context.
 *
 * Routes:
 *   POST /cross-memory/retrieve    — Retrieve relevant memories for a question
 *   POST /cross-memory/context     — Get a formatted context block ready for injection
 */

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  retrieveCrossConversationMemory,
  formatCrossMemoryContext,
} from "../lib/crossConversationMemory.js";

const retrieveSchema = z.object({
  question: z.string().min(1).max(5000),
  /** Max memories to return. Default: 10 */
  topN: z.number().int().min(1).max(50).optional().default(10),
});

export async function crossMemoryPlugin(app: FastifyInstance) {

  /**
   * POST /cross-memory/retrieve
   * Retrieves the most relevant memory facts and triples from prior conversations
   * based on keyword overlap with the current question.
   */
  app.post("/cross-memory/retrieve", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const parsed = retrieveSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });

    const { question, topN } = parsed.data;
    const memories = await retrieveCrossConversationMemory(userId, question, topN);

    return {
      success:  true,
      question: question.slice(0, 100),
      count:    memories.length,
      memories,
    };
  });

  /**
   * POST /cross-memory/context
   * Retrieves memories and returns a formatted context block
   * ready to be prepended to the council's system prompt.
   */
  app.post("/cross-memory/context", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const parsed = retrieveSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });

    const { question, topN } = parsed.data;
    const memories = await retrieveCrossConversationMemory(userId, question, topN);
    const contextBlock = formatCrossMemoryContext(memories);

    return {
      success:      true,
      memoryCount:  memories.length,
      contextBlock: contextBlock || null,
      hasContext:   contextBlock.length > 0,
    };
  });
}
