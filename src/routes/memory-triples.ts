/**
 * Triple-Store Memory Routes — Phase 2.2
 *
 * CRUD for RDF-style subject–predicate–object memory triples.
 *
 * GET    /memory/triples                — list triples (filter by subject/predicate)
 * POST   /memory/triples                — add a triple
 * DELETE /memory/triples/:id            — remove a triple
 * GET    /memory/triples/search         — search triples by subject or predicate pattern
 * POST   /memory/triples/extract        — extract triples from freetext (heuristic)
 */

import type { FastifyPluginAsync } from "fastify";
import { db } from "../lib/drizzle.js";
import { memoryTriples } from "../db/schema/memoryTriples.js";
import { eq, and, like, or, desc } from "drizzle-orm";
import { fastifyRequireAuth } from "../middleware/fastifyAuth.js";
import { z } from "zod";

const createSchema = z.object({
  subject: z.string().min(1).max(200),
  predicate: z.string().min(1).max(200),
  object: z.string().min(1).max(500),
  confidence: z.number().min(0).max(1).default(1.0),
  conversationId: z.string().uuid().optional(),
});

/**
 * Heuristic triple extractor: looks for "X is Y", "X has Y", "X uses Y" patterns.
 * Returns array of { subject, predicate, object } candidates.
 */
function extractTriples(text: string): Array<{ subject: string; predicate: string; object: string }> {
  const patterns: Array<{ regex: RegExp; predicate: string }> = [
    { regex: /(\w[\w\s]{1,30})\s+is\s+(a|an|the)?\s*([\w\s]{1,50})/gi, predicate: "is" },
    { regex: /(\w[\w\s]{1,30})\s+are\s+([\w\s]{1,50})/gi, predicate: "are" },
    { regex: /(\w[\w\s]{1,30})\s+uses?\s+([\w\s]{1,50})/gi, predicate: "uses" },
    { regex: /(\w[\w\s]{1,30})\s+(?:works?|working)\s+at\s+([\w\s]{1,50})/gi, predicate: "works at" },
    { regex: /(\w[\w\s]{1,30})\s+prefers?\s+([\w\s]{1,50})/gi, predicate: "prefers" },
    { regex: /(\w[\w\s]{1,30})\s+(?:likes?|loves?)\s+([\w\s]{1,50})/gi, predicate: "likes" },
  ];

  const results: Array<{ subject: string; predicate: string; object: string }> = [];

  for (const { regex, predicate } of patterns) {
    let match;
    while ((match = regex.exec(text)) !== null) {
      const subject = match[1].trim();
      const object = (match[3] ?? match[2]).trim();
      if (subject && object && subject.length < 100 && object.length < 200) {
        results.push({ subject, predicate, object });
      }
      regex.lastIndex = match.index + 1;
    }
    regex.lastIndex = 0;
  }

  return results.slice(0, 20); // Cap at 20 candidates
}

export const memoryTriplesPlugin: FastifyPluginAsync = async (fastify) => {
  fastify.addHook("preHandler", fastifyRequireAuth);

  // GET /memory/triples
  fastify.get("/memory/triples", { config: { rateLimit: { max: 100, timeWindow: "1 minute" } } }, async (request: any) => {
    const userId = request.user.userId;
    const { subject, predicate } = (request.query as any) ?? {};

    const conditions = [eq(memoryTriples.userId, userId)];
    if (subject) conditions.push(eq(memoryTriples.subject, subject));
    if (predicate) conditions.push(eq(memoryTriples.predicate, predicate));

    const rows = await db
      .select()
      .from(memoryTriples)
      .where(and(...conditions))
      .orderBy(desc(memoryTriples.observedAt))
      .limit(200);

    return { triples: rows };
  });

  // POST /memory/triples
  fastify.post("/memory/triples", { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (request: any, reply: any) => {
    const body = createSchema.safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({ error: "Validation failed", details: body.error.issues });
    }
    const d = body.data;

    const [triple] = await db
      .insert(memoryTriples)
      .values({
        userId: request.user.userId,
        subject: d.subject,
        predicate: d.predicate,
        object: d.object,
        confidence: d.confidence,
        conversationId: d.conversationId ?? null,
      })
      .returning();

    return reply.code(201).send({ triple });
  });

  // DELETE /memory/triples/:id
  fastify.delete("/memory/triples/:id", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (request: any, reply: any) => {
    const [deleted] = await db
      .delete(memoryTriples)
      .where(and(
        eq(memoryTriples.id, (request.params as any).id),
        eq(memoryTriples.userId, request.user.userId),
      ))
      .returning();

    if (!deleted) return reply.code(404).send({ error: "Triple not found" });
    return { success: true };
  });

  // GET /memory/triples/search?q=keyword
  fastify.get("/memory/triples/search", { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (request: any, reply: any) => {
    const userId = request.user.userId;
    const { q } = (request.query as any) ?? {};
    if (!q) return reply.code(400).send({ error: "Query parameter q is required" });

    const pattern = `%${q}%`;
    const rows = await db
      .select()
      .from(memoryTriples)
      .where(and(
        eq(memoryTriples.userId, userId),
        or(
          like(memoryTriples.subject, pattern),
          like(memoryTriples.predicate, pattern),
          like(memoryTriples.object, pattern),
        ),
      ))
      .orderBy(desc(memoryTriples.confidence))
      .limit(50);

    return { triples: rows };
  });

  // POST /memory/triples/extract — extract triples from freetext
  fastify.post("/memory/triples/extract", { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } }, async (request: any, reply: any) => {
    const { text, conversationId, save } = (request.body as any) ?? {};
    if (!text || typeof text !== "string") {
      return reply.code(400).send({ error: "text is required" });
    }

    const candidates = extractTriples(text.slice(0, 5000));

    if (save && candidates.length > 0) {
      const userId = request.user.userId;
      await db.insert(memoryTriples).values(
        candidates.map(c => ({
          userId,
          subject: c.subject,
          predicate: c.predicate,
          object: c.object,
          confidence: 0.7, // Heuristic extractions have lower confidence
          conversationId: conversationId ?? null,
        }))
      );
    }

    return { candidates, saved: save ? candidates.length : 0 };
  });
};
