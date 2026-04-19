import { FastifyPluginAsync } from "fastify";
import { fastifyRequireAuth } from "../middleware/fastifyAuth.js";
import {
  getConversationList,
  deleteConversation,
  updateConversationTitle,
  generateConversationSummary,
  findConversationById,
  searchChats
} from "../services/conversationService.js";
import { db } from "../lib/drizzle.js";
import { conversations, chats } from "../db/schema/conversations.js";
import { eq, and, asc, count, lte, sql } from "drizzle-orm";
import logger from "../lib/logger.js";

import { AppError } from "../middleware/errorHandler.js";
import { fastifyValidate, renameConversationSchema, forkSchema } from "../middleware/validate.js";

function parsePagination(query: { page?: string; limit?: string }, defaultLimit = 20, maxLimit = 100) {
  const page = Math.max(1, parseInt(query.page || '1', 10));
  const limit = Math.min(maxLimit, Math.max(1, parseInt(query.limit || defaultLimit.toString(), 10)));
  const skip = (page - 1) * limit;
  return { page, limit, skip };
}

function paginationMeta(page: number, limit: number, total: number) {
  return { page, limit, total, totalPages: Math.ceil(total / limit) };
}

const historyPlugin: FastifyPluginAsync = async (fastify) => {

  fastify.get("/search", { preHandler: fastifyRequireAuth }, async (request, _reply) => {
    try {
      const { q, limit = "10", projectId, after, before } = request.query as { q?: string; limit?: string; projectId?: string; after?: string; before?: string };

      if (!q || typeof q !== "string" || q.trim().length < 2) {
        return [];
      }

      const limitNum = Math.min(Math.max(parseInt(limit, 10) || 10, 1), 50);
      const filters = {
        projectId,
        after: after ? new Date(after) : undefined,
        before: before ? new Date(before) : undefined,
      };

      return await searchChats(request.userId!, q, limitNum, filters);
    } catch (err) {
      logger.error({ err, userId: request.userId }, "History search failed");
      return [];
    }
  });

    fastify.get("/", { preHandler: fastifyRequireAuth }, async (request, _reply) => {
    const { page, limit, skip } = parsePagination(request.query as { page?: string; limit?: string });
    const { projectId, after, before } = request.query as { projectId?: string; after?: string; before?: string };

    const filters = {
      projectId,
      after: after ? new Date(after) : undefined,
      before: before ? new Date(before) : undefined,
    };

    const { data, total } = await getConversationList(request.userId!, limit, skip, filters);

    return {
      data,
      pagination: paginationMeta(page, limit, total)
    };
  });

    fastify.get("/:id", { preHandler: fastifyRequireAuth }, async (request, _reply) => {
    const { id } = request.params as { id: string };
    const { page, limit, skip } = parsePagination(request.query as { page?: string; limit?: string }, 50);

    const conversationRows = await db
      .select()
      .from(conversations)
      .where(and(eq(conversations.id, id), eq(conversations.userId, request.userId!)))
      .limit(1);

    const conversation = conversationRows[0];

    if (!conversation) {
      throw new AppError(404, "Conversation not found");
    }

    const [chatRows, totalResult] = await Promise.all([
      db
        .select()
        .from(chats)
        .where(eq(chats.conversationId, id))
        .orderBy(asc(chats.createdAt))
        .offset(skip)
        .limit(limit),
      db
        .select({ value: count() })
        .from(chats)
        .where(eq(chats.conversationId, id))
    ]);

    const totalChats = totalResult[0]?.value ?? 0;

    return {
      ...conversation,
      Chat: chatRows,
      pagination: paginationMeta(page, limit, totalChats)
    };
  });

    fastify.patch("/:id", { preHandler: [fastifyRequireAuth, fastifyValidate(renameConversationSchema)] }, async (request, _reply) => {
    const { id } = request.params as { id: string };
    const { title } = request.body as { title: string };

    const updated = await updateConversationTitle(id, request.userId!, title);
    if (!updated) throw new AppError(404, "Conversation not found");
    return { success: true, title };
  });

    fastify.delete("/:id", { preHandler: fastifyRequireAuth }, async (request, _reply) => {
    const { id } = request.params as { id: string };
    const deleted = await deleteConversation(id, request.userId!);
    if (!deleted) throw new AppError(404, "Conversation not found");
    return { success: true };
  });

    fastify.post("/:id/fork", { preHandler: [fastifyRequireAuth, fastifyValidate(forkSchema)] }, async (request, _reply) => {
    const { id } = request.params as { id: string };
    const { toChatId } = request.body as { toChatId: number };

    const sourceRows = await db
      .select()
      .from(conversations)
      .where(and(eq(conversations.id, id), eq(conversations.userId, request.userId!)))
      .limit(1);

    const source = sourceRows[0];
    if (!source) throw new AppError(404, "Source conversation not found");

    const chatsToFork = await db
      .select()
      .from(chats)
      .where(
        and(
          eq(chats.conversationId, id),
          lte(chats.id, Number(toChatId))
        )
      )
      .orderBy(asc(chats.createdAt));

    if (!chatsToFork.length) throw new AppError(400, "No messages to fork");

    const forkRows = await db
      .insert(conversations)
      .values({
        id: sql`gen_random_uuid()`,
        userId: request.userId!,
        title: `Fork of: ${source.title}`,
        updatedAt: new Date(),
      })
      .returning();

    const fork = forkRows[0];

    await db.insert(chats).values(
      chatsToFork.map((c) => ({
        userId: request.userId!,
        conversationId: fork.id,
        question: c.question,
        verdict: c.verdict,
        opinions: c.opinions,
      }))
    );

    return { success: true, forkId: fork.id, count: chatsToFork.length };
  });

    fastify.get("/shared/:id", async (request, _reply) => {
    const { id } = request.params as { id: string };

    const conversationRows = await db
      .select()
      .from(conversations)
      .where(and(eq(conversations.id, id), eq(conversations.isPublic, true)))
      .limit(1);

    const conversation = conversationRows[0];

    if (!conversation) {
      throw new AppError(404, "Public conversation not found");
    }

    const chatRows = await db
      .select()
      .from(chats)
      .where(eq(chats.conversationId, id))
      .orderBy(asc(chats.createdAt));

    return {
      ...conversation,
      Chat: chatRows,
    };
  });

    fastify.patch("/:id/share", { preHandler: fastifyRequireAuth }, async (request, _reply) => {
    const { id } = request.params as { id: string };
    const { isPublic } = request.body as { isPublic: boolean };

    if (typeof isPublic !== "boolean") {
      throw new AppError(400, "isPublic must be a boolean");
    }

    const updated = await db
      .update(conversations)
      .set({ isPublic })
      .where(and(eq(conversations.id, id), eq(conversations.userId, request.userId!)))
      .returning();

    if (updated.length === 0) throw new AppError(404, "Conversation not found");
    return { success: true, isPublic };
  });

  fastify.get("/:id/summary", { preHandler: fastifyRequireAuth }, async (request, _reply) => {
    const { id } = request.params as { id: string };
    const userId = request.userId!;

    try {
      const conv = await findConversationById(id, userId);
      if (!conv) {
        throw new AppError(404, "Conversation not found");
      }
      return (conv as unknown as { summaryData?: unknown }).summaryData || null;
    } catch (err) {
      if (err instanceof AppError) throw err;
      logger.error({ err, id }, "Failed to fetch summary");
      throw new AppError(500, "Internal server error");
    }
  });

  fastify.post("/:id/summary", { preHandler: fastifyRequireAuth }, async (request, _reply) => {
    const { id } = request.params as { id: string };
    const userId = request.userId!;

    try {
      const summary = await generateConversationSummary(id, userId);
      return summary;
    } catch (err) {
      if (err instanceof AppError) throw err;
      logger.error({ err, id }, "Failed to generate summary");
      throw new AppError(500, "Internal server error");
    }
  });
};

export default historyPlugin;
