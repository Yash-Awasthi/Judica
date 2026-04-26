/**
 * Goal Document routes — Phase 2.8
 *
 * CRUD + toggle for per-user goal documents.
 * Active goal document is injected into every council call as silent context.
 *
 * Inspired by: Cursor .cursorrules, CLAUDE.md persistent context files.
 */

import type { FastifyInstance } from "fastify";
import { db } from "../lib/drizzle.js";
import { goalDocuments } from "../db/schema/goalDocuments.js";
import { eq, and } from "drizzle-orm";
import { z } from "zod";

const createSchema = z.object({
  title:    z.string().min(1).max(200).optional(),
  content:  z.string().min(1).max(10_000),
  isActive: z.boolean().optional(),
});

const updateSchema = createSchema.partial();

export async function goalDocumentsPlugin(app: FastifyInstance) {
  // GET /goal-documents — list all for current user
  app.get("/goal-documents", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const docs = await db
      .select()
      .from(goalDocuments)
      .where(eq(goalDocuments.userId, userId));

    return { success: true, documents: docs };
  });

  // GET /goal-documents/active — get currently active goal document
  app.get("/goal-documents/active", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const [doc] = await db
      .select()
      .from(goalDocuments)
      .where(and(
        eq(goalDocuments.userId, userId),
        eq(goalDocuments.isActive, true),
      ))
      .limit(1);

    return { success: true, document: doc ?? null };
  });

  // POST /goal-documents — create new goal document
  app.post("/goal-documents", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });

    const { title = "My Goal Document", content, isActive = false } = parsed.data;

    // If activating this doc, deactivate all others first
    if (isActive) {
      await db
        .update(goalDocuments)
        .set({ isActive: false })
        .where(eq(goalDocuments.userId, userId));
    }

    const [doc] = await db
      .insert(goalDocuments)
      .values({ userId, title, content, isActive })
      .returning();

    return reply.status(201).send({ success: true, document: doc });
  });

  // PATCH /goal-documents/:id — update a goal document
  app.patch("/goal-documents/:id", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const id = Number((req.params as any).id);
    if (isNaN(id)) return reply.status(400).send({ error: "Invalid id" });

    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });

    // Verify ownership
    const [existing] = await db
      .select({ id: goalDocuments.id })
      .from(goalDocuments)
      .where(and(eq(goalDocuments.id, id), eq(goalDocuments.userId, userId)))
      .limit(1);

    if (!existing) return reply.status(404).send({ error: "Not found" });

    // If activating this one, deactivate all others
    if (parsed.data.isActive) {
      await db
        .update(goalDocuments)
        .set({ isActive: false })
        .where(eq(goalDocuments.userId, userId));
    }

    const [updated] = await db
      .update(goalDocuments)
      .set({ ...parsed.data, updatedAt: new Date() })
      .where(eq(goalDocuments.id, id))
      .returning();

    return { success: true, document: updated };
  });

  // POST /goal-documents/:id/activate — toggle active (exclusive per user)
  app.post("/goal-documents/:id/activate", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const id = Number((req.params as any).id);
    if (isNaN(id)) return reply.status(400).send({ error: "Invalid id" });

    const [existing] = await db
      .select()
      .from(goalDocuments)
      .where(and(eq(goalDocuments.id, id), eq(goalDocuments.userId, userId)))
      .limit(1);

    if (!existing) return reply.status(404).send({ error: "Not found" });

    // If it was already active, deactivate; otherwise activate exclusively
    const newActive = !existing.isActive;

    if (newActive) {
      await db
        .update(goalDocuments)
        .set({ isActive: false })
        .where(eq(goalDocuments.userId, userId));
    }

    const [updated] = await db
      .update(goalDocuments)
      .set({ isActive: newActive, updatedAt: new Date() })
      .where(eq(goalDocuments.id, id))
      .returning();

    return { success: true, document: updated, active: newActive };
  });

  // DELETE /goal-documents/:id
  app.delete("/goal-documents/:id", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const id = Number((req.params as any).id);
    if (isNaN(id)) return reply.status(400).send({ error: "Invalid id" });

    const [deleted] = await db
      .delete(goalDocuments)
      .where(and(eq(goalDocuments.id, id), eq(goalDocuments.userId, userId)))
      .returning({ id: goalDocuments.id });

    if (!deleted) return reply.status(404).send({ error: "Not found" });

    return { success: true };
  });
}
