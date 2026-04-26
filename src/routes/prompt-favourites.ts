/**
 * Prompt Favourites Routes — Phase 1.26
 *
 * CRUD for bookmarked prompts + use-tracking.
 * Inspired by TypingMind saved prompts and Open WebUI prompt library.
 *
 * GET    /prompt-favourites            — list all (with optional folder filter)
 * POST   /prompt-favourites            — save a prompt
 * PUT    /prompt-favourites/:id        — update title/prompt/tags
 * DELETE /prompt-favourites/:id        — delete
 * POST   /prompt-favourites/:id/use    — increment use count, update lastUsedAt
 * GET    /prompt-history               — recent 50 unique questions (from chats table)
 */

import type { FastifyPluginAsync } from "fastify";
import { db } from "../lib/drizzle.js";
import { promptFavourites } from "../db/schema/promptFavourites.js";
import { chats } from "../db/schema/conversations.js";
import { eq, and, desc, sql } from "drizzle-orm";
import { fastifyRequireAuth } from "../middleware/fastifyAuth.js";
import { z } from "zod";

const createSchema = z.object({
  title: z.string().min(1).max(200),
  prompt: z.string().min(1).max(5000),
  folder: z.string().max(100).optional(),
  tags: z.array(z.string().max(50)).max(20).optional(),
  isPinned: z.boolean().default(false),
});

const updateSchema = createSchema.partial();

export const promptFavouritesPlugin: FastifyPluginAsync = async (fastify) => {
  fastify.addHook("preHandler", fastifyRequireAuth);

  // GET /prompt-favourites
  fastify.get("/prompt-favourites", async (request: any) => {
    const userId = request.user.userId;
    const { folder } = (request.query as any) ?? {};

    const conditions = [eq(promptFavourites.userId, userId)];
    if (folder) conditions.push(eq(promptFavourites.folder, folder));

    const rows = await db
      .select()
      .from(promptFavourites)
      .where(and(...conditions))
      .orderBy(desc(promptFavourites.isPinned), desc(promptFavourites.lastUsedAt));

    return { favourites: rows };
  });

  // POST /prompt-favourites
  fastify.post("/prompt-favourites", async (request: any, reply: any) => {
    const body = createSchema.safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({ error: "Validation failed", details: body.error.issues });
    }
    const d = body.data;

    const [row] = await db
      .insert(promptFavourites)
      .values({
        userId: request.user.userId,
        title: d.title,
        prompt: d.prompt,
        folder: d.folder ?? null,
        tags: d.tags ?? null,
        isPinned: d.isPinned,
      })
      .returning();

    return reply.code(201).send({ favourite: row });
  });

  // PUT /prompt-favourites/:id
  fastify.put("/prompt-favourites/:id", async (request: any, reply: any) => {
    const userId = request.user.userId;
    const { id } = request.params as { id: string };
    const body = updateSchema.safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({ error: "Validation failed", details: body.error.issues });
    }

    const update: Record<string, unknown> = { updatedAt: new Date() };
    const d = body.data;
    if (d.title !== undefined) update.title = d.title;
    if (d.prompt !== undefined) update.prompt = d.prompt;
    if (d.folder !== undefined) update.folder = d.folder;
    if (d.tags !== undefined) update.tags = d.tags;
    if (d.isPinned !== undefined) update.isPinned = d.isPinned;

    const [updated] = await db
      .update(promptFavourites)
      .set(update)
      .where(and(eq(promptFavourites.id, id), eq(promptFavourites.userId, userId)))
      .returning();

    if (!updated) return reply.code(404).send({ error: "Favourite not found" });
    return { favourite: updated };
  });

  // DELETE /prompt-favourites/:id
  fastify.delete("/prompt-favourites/:id", async (request: any, reply: any) => {
    const [deleted] = await db
      .delete(promptFavourites)
      .where(and(
        eq(promptFavourites.id, (request.params as any).id),
        eq(promptFavourites.userId, request.user.userId),
      ))
      .returning();

    if (!deleted) return reply.code(404).send({ error: "Favourite not found" });
    return { success: true };
  });

  // POST /prompt-favourites/:id/use — track usage
  fastify.post("/prompt-favourites/:id/use", async (request: any, reply: any) => {
    const [updated] = await db
      .update(promptFavourites)
      .set({
        useCount: sql`${promptFavourites.useCount} + 1`,
        lastUsedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(and(
        eq(promptFavourites.id, (request.params as any).id),
        eq(promptFavourites.userId, request.user.userId),
      ))
      .returning();

    if (!updated) return reply.code(404).send({ error: "Favourite not found" });
    return { favourite: updated };
  });

  // GET /prompt-history — recent unique questions from conversation history
  fastify.get("/prompt-history", async (request: any) => {
    const userId = request.user.userId;
    const rows = await db
      .selectDistinctOn([chats.question], {
        question: chats.question,
        createdAt: chats.createdAt,
      })
      .from(chats)
      .where(eq(chats.userId, userId))
      .orderBy(chats.question, desc(chats.createdAt))
      .limit(50);

    // Re-sort by most recent
    rows.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    return { history: rows.slice(0, 50) };
  });
};
