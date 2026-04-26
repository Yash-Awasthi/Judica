/**
 * Workspace Routes — Phase 1.18
 *
 * GET    /workspaces               — list user's workspaces
 * POST   /workspaces               — create workspace
 * GET    /workspaces/:slug         — get workspace by slug
 * PUT    /workspaces/:slug         — update workspace
 * DELETE /workspaces/:slug         — soft-delete workspace
 * POST   /workspaces/:slug/default — set as default workspace
 */

import type { FastifyPluginAsync } from "fastify";
import { db } from "../lib/drizzle.js";
import { workspaces } from "../db/schema/workspaces.js";
import { eq, and, isNull, desc } from "drizzle-orm";
import { fastifyRequireAuth } from "../middleware/fastifyAuth.js";
import { z } from "zod";

const slugRegex = /^[a-z0-9-]+$/;

const workspaceSchema = z.object({
  slug: z.string().min(2).max(60).regex(slugRegex, "Slug must be lowercase alphanumeric with hyphens"),
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  icon: z.string().max(50).optional(),
  councilConfig: z.array(z.record(z.string(), z.unknown())).max(10).optional(),
  masterConfig: z.record(z.string(), z.unknown()).optional(),
  kbId: z.string().uuid().optional(),
  systemPrompt: z.string().max(5000).optional(),
  deliberationMode: z.enum(["standard", "socratic", "red_blue", "hypothesis", "confidence"]).optional(),
});

export const workspacesPlugin: FastifyPluginAsync = async (fastify) => {
  fastify.addHook("preHandler", fastifyRequireAuth);

  // GET /workspaces
  fastify.get("/workspaces", async (request: any) => {
    const rows = await db
      .select()
      .from(workspaces)
      .where(and(eq(workspaces.userId, request.user.userId), isNull(workspaces.deletedAt)))
      .orderBy(desc(workspaces.createdAt));
    return { workspaces: rows };
  });

  // POST /workspaces
  fastify.post("/workspaces", { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } }, async (request: any, reply: any) => {
    const body = workspaceSchema.safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({ error: "Validation failed", details: body.error.issues });
    }
    const d = body.data;
    const userId = request.user.userId;

    // Check for duplicate slug
    const [existing] = await db
      .select({ id: workspaces.id })
      .from(workspaces)
      .where(and(eq(workspaces.userId, userId), eq(workspaces.slug, d.slug), isNull(workspaces.deletedAt)))
      .limit(1);
    if (existing) return reply.code(409).send({ error: "A workspace with that slug already exists" });

    const [ws] = await db
      .insert(workspaces)
      .values({
        userId,
        slug: d.slug,
        name: d.name,
        description: d.description ?? null,
        icon: d.icon ?? null,
        councilConfig: d.councilConfig ?? null,
        masterConfig: d.masterConfig ?? null,
        kbId: d.kbId ?? null,
        systemPrompt: d.systemPrompt ?? null,
        deliberationMode: d.deliberationMode ?? "standard",
      })
      .returning();

    return reply.code(201).send({ workspace: ws });
  });

  // GET /workspaces/:slug
  fastify.get("/workspaces/:slug", async (request: any, reply: any) => {
    const [ws] = await db
      .select()
      .from(workspaces)
      .where(and(
        eq(workspaces.userId, request.user.userId),
        eq(workspaces.slug, (request.params as any).slug),
        isNull(workspaces.deletedAt),
      ))
      .limit(1);
    if (!ws) return reply.code(404).send({ error: "Workspace not found" });
    return { workspace: ws };
  });

  // PUT /workspaces/:slug
  fastify.put("/workspaces/:slug", async (request: any, reply: any) => {
    const userId = request.user.userId;
    const { slug } = request.params as { slug: string };
    const body = workspaceSchema.partial().safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({ error: "Validation failed", details: body.error.issues });
    }
    const d = body.data;

    const update: Record<string, unknown> = { updatedAt: new Date() };
    if (d.name !== undefined) update.name = d.name;
    if (d.description !== undefined) update.description = d.description;
    if (d.icon !== undefined) update.icon = d.icon;
    if (d.councilConfig !== undefined) update.councilConfig = d.councilConfig;
    if (d.masterConfig !== undefined) update.masterConfig = d.masterConfig;
    if (d.kbId !== undefined) update.kbId = d.kbId;
    if (d.systemPrompt !== undefined) update.systemPrompt = d.systemPrompt;
    if (d.deliberationMode !== undefined) update.deliberationMode = d.deliberationMode;

    const [updated] = await db
      .update(workspaces)
      .set(update)
      .where(and(eq(workspaces.userId, userId), eq(workspaces.slug, slug), isNull(workspaces.deletedAt)))
      .returning();

    if (!updated) return reply.code(404).send({ error: "Workspace not found" });
    return { workspace: updated };
  });

  // DELETE /workspaces/:slug — soft delete
  fastify.delete("/workspaces/:slug", async (request: any, reply: any) => {
    const [deleted] = await db
      .update(workspaces)
      .set({ deletedAt: new Date() })
      .where(and(
        eq(workspaces.userId, request.user.userId),
        eq(workspaces.slug, (request.params as any).slug),
        isNull(workspaces.deletedAt),
      ))
      .returning();

    if (!deleted) return reply.code(404).send({ error: "Workspace not found" });
    return { success: true };
  });

  // POST /workspaces/:slug/default
  fastify.post("/workspaces/:slug/default", async (request: any, reply: any) => {
    const userId = request.user.userId;
    const { slug } = request.params as { slug: string };

    // Clear existing default
    await db
      .update(workspaces)
      .set({ isDefault: false })
      .where(and(eq(workspaces.userId, userId), isNull(workspaces.deletedAt)));

    const [updated] = await db
      .update(workspaces)
      .set({ isDefault: true, updatedAt: new Date() })
      .where(and(eq(workspaces.userId, userId), eq(workspaces.slug, slug), isNull(workspaces.deletedAt)))
      .returning();

    if (!updated) return reply.code(404).send({ error: "Workspace not found" });
    return { workspace: updated };
  });
};
