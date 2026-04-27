/**
 * Memory Import/Export routes — Phase 2.16
 *
 * Export all stored memories as a portable JSON file.
 * Import from a file to restore or migrate between accounts.
 * Full data portability — you own your memory, not the platform.
 *
 * Inspired by:
 * - GDPR Article 20 — right to data portability
 * - ActivityPub (W3C) — portable social data standard
 * - mem0 (Apache 2.0, mem0ai/mem0) — memory export/import APIs
 */

import type { FastifyInstance } from "fastify";
import { db } from "../lib/drizzle.js";
import { memoryFacts } from "../db/schema/memoryFacts.js";
import { memoryTriples } from "../db/schema/memoryTriples.js";
import { agentMemories } from "../db/schema/agentMemories.js";
import { eq } from "drizzle-orm";
import { z } from "zod";

export interface MemoryExport {
  version:       "1.0";
  exportedAt:    string;
  userId:        number;
  facts:         Array<{ fact: string; scope?: string; decayScore?: number; conversationId?: string | null }>;
  triples:       Array<{ subject: string; predicate: string; object: string; confidence?: number }>;
  agentMemories: Array<{ agentId: string; agentLabel?: string | null; fact: string; confidence?: number }>;
}

const importSchema = z.object({
  data: z.object({
    version:       z.literal("1.0"),
    facts:         z.array(z.object({
      fact:           z.string(),
      scope:          z.string().optional(),
      decayScore:     z.number().optional(),
      conversationId: z.string().nullable().optional(),
    })).optional().default([]),
    triples:       z.array(z.object({
      subject:    z.string(),
      predicate:  z.string(),
      object:     z.string(),
      confidence: z.number().optional(),
    })).optional().default([]),
    agentMemories: z.array(z.object({
      agentId:    z.string(),
      agentLabel: z.string().nullable().optional(),
      fact:       z.string(),
      confidence: z.number().optional(),
    })).optional().default([]),
  }),
  merge: z.boolean().default(false), // false = replace, true = merge
});

export async function memoryPortabilityPlugin(app: FastifyInstance) {
  // GET /memory/export — download full memory snapshot as JSON
  app.get("/memory/export", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const [facts, triples, agentMems] = await Promise.all([
      db.select().from(memoryFacts).where(eq(memoryFacts.userId, userId)),
      db.select().from(memoryTriples).where(eq(memoryTriples.userId, userId)),
      db.select().from(agentMemories).where(eq(agentMemories.userId, userId)),
    ]);

    const payload: MemoryExport = {
      version:       "1.0",
      exportedAt:    new Date().toISOString(),
      userId,
      facts:         facts.map(f => ({
        fact:           f.fact,
        scope:          (f as any).scope,
        decayScore:     f.decayScore ?? undefined,
        conversationId: f.conversationId,
      })),
      triples:       triples.map(t => ({
        subject:    t.subject,
        predicate:  t.predicate,
        object:     t.object,
        confidence: t.confidence ?? undefined,
      })),
      agentMemories: agentMems.map(a => ({
        agentId:    a.agentId,
        agentLabel: a.agentLabel,
        fact:       a.fact,
        confidence: a.confidence ?? undefined,
      })),
    };

    reply.header("Content-Type", "application/json");
    reply.header("Content-Disposition", `attachment; filename=judica-memory-${Date.now()}.json`);
    return reply.send(JSON.stringify(payload, null, 2));
  });

  // GET /memory/export/stats — summary stats without full data
  app.get("/memory/export/stats", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const [facts, triples, agentMems] = await Promise.all([
      db.select({ id: memoryFacts.id }).from(memoryFacts).where(eq(memoryFacts.userId, userId)),
      db.select({ id: memoryTriples.id }).from(memoryTriples).where(eq(memoryTriples.userId, userId)),
      db.select({ id: agentMemories.id }).from(agentMemories).where(eq(agentMemories.userId, userId)),
    ]);

    return {
      success: true,
      stats:   { facts: facts.length, triples: triples.length, agentMemories: agentMems.length },
    };
  });

  // POST /memory/import — import memory snapshot
  app.post("/memory/import", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const parsed = importSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });

    const { data, merge } = parsed.data;

    if (!merge) {
      // Delete existing memories before import
      await Promise.all([
        db.delete(memoryFacts).where(eq(memoryFacts.userId, userId)),
        db.delete(memoryTriples).where(eq(memoryTriples.userId, userId)),
        db.delete(agentMemories).where(eq(agentMemories.userId, userId)),
      ]);
    }

    let factCount = 0, tripleCount = 0, agentMemCount = 0;

    if (data.facts?.length) {
      await db.insert(memoryFacts).values(
        data.facts.map(f => ({
          userId,
          fact:           f.fact,
          decayScore:     f.decayScore ?? 1.0,
          conversationId: f.conversationId ?? null,
        }))
      );
      factCount = data.facts.length;
    }

    if (data.triples?.length) {
      await db.insert(memoryTriples).values(
        data.triples.map(t => ({
          userId,
          subject:    t.subject,
          predicate:  t.predicate,
          object:     t.object,
          confidence: t.confidence ?? 1.0,
        }))
      );
      tripleCount = data.triples.length;
    }

    if (data.agentMemories?.length) {
      await db.insert(agentMemories).values(
        data.agentMemories.map(a => ({
          userId,
          agentId:    a.agentId,
          agentLabel: a.agentLabel ?? null,
          fact:       a.fact,
          confidence: a.confidence ?? 1.0,
          decayScore: 1.0,
        }))
      );
      agentMemCount = data.agentMemories.length;
    }

    return {
      success:  true,
      mode:     merge ? "merge" : "replace",
      imported: { facts: factCount, triples: tripleCount, agentMemories: agentMemCount },
    };
  });
}
