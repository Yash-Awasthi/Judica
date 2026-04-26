/**
 * Idea Evolution Tree Routes — Phase 1.13
 *
 * CRUD for idea tree nodes + tree fetch.
 * Inspired by Markmap (MIT) and D3 hierarchy patterns.
 *
 * GET  /ideas                  — list root nodes (parentId = null)
 * GET  /ideas/tree/:rootId     — full subtree from a root node
 * POST /ideas                  — create a node (optionally with parentId)
 * PATCH /ideas/:id             — update label/content
 * DELETE /ideas/:id            — delete node (children become orphans → parentId = null)
 */

import type { FastifyPluginAsync } from "fastify";
import { db } from "../lib/drizzle.js";
import { ideaNodes } from "../db/schema/ideaNodes.js";
import { eq, and, isNull } from "drizzle-orm";
import { fastifyRequireAuth } from "../middleware/fastifyAuth.js";
import { z } from "zod";

const createSchema = z.object({
  label: z.string().min(1).max(200),
  content: z.string().max(5000).optional(),
  parentId: z.string().uuid().optional(),
  conversationId: z.string().uuid().optional(),
  meta: z.record(z.unknown()).optional(),
});

const updateSchema = z.object({
  label: z.string().min(1).max(200).optional(),
  content: z.string().max(5000).optional(),
  meta: z.record(z.unknown()).optional(),
});

/** Recursively fetch children for a node (BFS using DB queries) */
async function fetchSubtree(rootId: string, userId: number): Promise<unknown> {
  const node = await db
    .select()
    .from(ideaNodes)
    .where(and(eq(ideaNodes.id, rootId), eq(ideaNodes.userId, userId)))
    .limit(1);

  if (!node[0]) return null;

  const children = await db
    .select()
    .from(ideaNodes)
    .where(and(eq(ideaNodes.parentId, rootId), eq(ideaNodes.userId, userId)));

  const childTrees = await Promise.all(
    children.map((c) => fetchSubtree(c.id, userId)),
  );

  return { ...node[0], children: childTrees.filter(Boolean) };
}

export const ideaNodesPlugin: FastifyPluginAsync = async (fastify) => {
  fastify.addHook("preHandler", fastifyRequireAuth);

  // GET /ideas — list root nodes
  fastify.get("/ideas", async (request: any) => {
    const userId = request.user.userId;
    const roots = await db
      .select()
      .from(ideaNodes)
      .where(and(eq(ideaNodes.userId, userId), isNull(ideaNodes.parentId)));
    return { nodes: roots };
  });

  // GET /ideas/tree/:rootId — full subtree
  fastify.get("/ideas/tree/:rootId", async (request: any, reply: any) => {
    const userId = request.user.userId;
    const { rootId } = request.params as { rootId: string };
    const tree = await fetchSubtree(rootId, userId);
    if (!tree) return reply.code(404).send({ error: "Root node not found" });
    return { tree };
  });

  // POST /ideas
  fastify.post("/ideas", async (request: any, reply: any) => {
    const userId = request.user.userId;
    const body = createSchema.safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({ error: "Validation failed", details: body.error.issues });
    }
    const { label, content, parentId, conversationId, meta } = body.data;

    const [node] = await db
      .insert(ideaNodes)
      .values({
        userId,
        label,
        content: content ?? null,
        parentId: parentId ?? null,
        conversationId: conversationId ?? null,
        meta: meta ?? null,
      })
      .returning();

    return reply.code(201).send({ node });
  });

  // PATCH /ideas/:id
  fastify.patch("/ideas/:id", async (request: any, reply: any) => {
    const userId = request.user.userId;
    const { id } = request.params as { id: string };
    const body = updateSchema.safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({ error: "Validation failed", details: body.error.issues });
    }

    const update: Record<string, unknown> = { updatedAt: new Date() };
    if (body.data.label !== undefined) update.label = body.data.label;
    if (body.data.content !== undefined) update.content = body.data.content;
    if (body.data.meta !== undefined) update.meta = body.data.meta;

    const [updated] = await db
      .update(ideaNodes)
      .set(update)
      .where(and(eq(ideaNodes.id, id), eq(ideaNodes.userId, userId)))
      .returning();

    if (!updated) return reply.code(404).send({ error: "Node not found" });
    return { node: updated };
  });

  // DELETE /ideas/:id
  fastify.delete("/ideas/:id", async (request: any, reply: any) => {
    const userId = request.user.userId;
    const { id } = request.params as { id: string };

    const [deleted] = await db
      .delete(ideaNodes)
      .where(and(eq(ideaNodes.id, id), eq(ideaNodes.userId, userId)))
      .returning();

    if (!deleted) return reply.code(404).send({ error: "Node not found" });
    return { success: true };
  });
};
