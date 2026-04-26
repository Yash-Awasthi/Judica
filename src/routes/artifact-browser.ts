/**
 * Artifact Browser routes — Phase 3.6
 *
 * Extended browsing capabilities on top of the existing artifacts route:
 * - Stats endpoint (counts by type, total size)
 * - Public sharing toggle
 * - Type-filtered listing
 * - Source code association
 *
 * Inspired by:
 * - Anthropic Artifacts — in-conversation artifact panel
 * - Open Interpreter (AGPL, OpenInterpreter/open-interpreter) — file output management
 * - E2B (Apache 2.0, e2b-dev/e2b) — sandboxed code execution with artifact handling
 */

import { FastifyInstance } from "fastify";
import { db } from "../lib/drizzle.js";
import { artifacts } from "../db/schema/research.js";
import { eq, and, desc, sql } from "drizzle-orm";
import { z } from "zod";

const updateBrowserSchema = z.object({
  isPublic:   z.boolean().optional(),
  sourceCode: z.string().optional(),
  storageUrl: z.string().url().optional(),
  storageKey: z.string().optional(),
});

export async function artifactBrowserPlugin(app: FastifyInstance) {
  // GET /artifact-browser/stats — aggregate stats: counts by type, total
  app.get("/artifact-browser/stats", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const rows = await db
      .select({
        type:  artifacts.type,
        count: sql<number>`count(*)`.as("count"),
      })
      .from(artifacts)
      .where(eq(artifacts.userId, userId))
      .groupBy(artifacts.type);

    const byType: Record<string, number> = {};
    let total = 0;
    for (const r of rows) {
      byType[r.type] = Number(r.count);
      total += Number(r.count);
    }

    return { success: true, total, byType };
  });

  // GET /artifact-browser/by-type/:type — artifacts filtered by type
  app.get("/artifact-browser/by-type/:type", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const type = (req.params as any).type as string;

    const rows = await db
      .select({
        id:             artifacts.id,
        name:           artifacts.name,
        type:           artifacts.type,
        language:       artifacts.language,
        conversationId: artifacts.conversationId,
        createdAt:      artifacts.createdAt,
      })
      .from(artifacts)
      .where(and(eq(artifacts.userId, userId), eq(artifacts.type, type)))
      .orderBy(desc(artifacts.createdAt))
      .limit(100);

    return { success: true, artifacts: rows };
  });

  // PATCH /artifact-browser/:id — update browser-specific fields (public toggle, storageUrl)
  app.patch("/artifact-browser/:id", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const id = (req.params as any).id as string;

    const parsed = updateBrowserSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });

    const [existing] = await db
      .select({ id: artifacts.id })
      .from(artifacts)
      .where(and(eq(artifacts.id, id), eq(artifacts.userId, userId)))
      .limit(1);

    if (!existing) return reply.status(404).send({ error: "Not found" });

    const updates: Record<string, unknown> = {};
    if (parsed.data.isPublic   !== undefined) (updates as any).isPublic   = parsed.data.isPublic;
    if (parsed.data.sourceCode !== undefined) (updates as any).sourceCode = parsed.data.sourceCode;
    if (parsed.data.storageUrl !== undefined) (updates as any).storageUrl = parsed.data.storageUrl;
    if (parsed.data.storageKey !== undefined) (updates as any).storageKey = parsed.data.storageKey;

    const [updated] = await db
      .update(artifacts)
      .set(updates)
      .where(eq(artifacts.id, id))
      .returning();

    return { success: true, artifact: updated };
  });

  // GET /artifact-browser/public/:id — public access (no auth required)
  app.get("/artifact-browser/public/:id", async (req, reply) => {
    const id = (req.params as any).id as string;

    const [artifact] = await db
      .select()
      .from(artifacts)
      .where(and(eq(artifacts.id, id), eq((artifacts as any).isPublic, true)))
      .limit(1);

    if (!artifact) return reply.status(404).send({ error: "Not found or not public" });
    return { success: true, artifact };
  });
}
