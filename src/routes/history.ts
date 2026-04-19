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
import { eq, and, or, ilike, asc, desc, count, lte, sql } from "drizzle-orm";
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

/**
 * @openapi
 * /api/history/search:
 *   get:
 *     tags:
 *       - History
 *     summary: Search conversations
 *     description: Search through the authenticated user's conversation history by question or verdict text.
 *     parameters:
 *       - in: query
 *         name: q
 *         required: true
 *         schema:
 *           type: string
 *           minLength: 2
 *         description: Search query string (minimum 2 characters)
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 10
 *           minimum: 1
 *           maximum: 50
 *         description: Maximum number of results to return
 *     responses:
 *       200:
 *         description: Array of matching chat messages
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   id:
 *                     type: integer
 *                   conversationId:
 *                     type: string
 *                   question:
 *                     type: string
 *                   verdict:
 *                     type: string
 *                   createdAt:
 *                     type: string
 *                     format: date-time
 *       401:
 *         description: Unauthorized
 */
const historyPlugin: FastifyPluginAsync = async (fastify) => {

  fastify.get("/search", { preHandler: fastifyRequireAuth }, async (request, reply) => {
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

  /**
   * @openapi
   * /api/history:
   *   get:
   *     tags:
   *       - History
   *     summary: List conversations
   *     description: Retrieve a paginated list of the authenticated user's conversations.
   *     parameters:
   *       - in: query
   *         name: page
   *         schema:
   *           type: integer
   *           default: 1
   *           minimum: 1
   *         description: Page number
   *       - in: query
   *         name: limit
   *         schema:
   *           type: integer
   *           default: 20
   *           minimum: 1
   *           maximum: 100
   *         description: Number of conversations per page
   *     responses:
   *       200:
   *         description: Paginated list of conversations
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 data:
   *                   type: array
   *                   items:
   *                     type: object
   *                     properties:
   *                       id:
   *                         type: string
   *                       title:
   *                         type: string
   *                       createdAt:
   *                         type: string
   *                         format: date-time
   *                 pagination:
   *                   type: object
   *                   properties:
   *                     page:
   *                       type: integer
   *                     limit:
   *                       type: integer
   *                     total:
   *                       type: integer
   *                     totalPages:
   *                       type: integer
   *       401:
   *         description: Unauthorized
   */
  fastify.get("/", { preHandler: fastifyRequireAuth }, async (request, reply) => {
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

  /**
   * @openapi
   * /api/history/{id}:
   *   get:
   *     tags:
   *       - History
   *     summary: Get conversation messages
   *     description: Retrieve a single conversation with its paginated chat messages.
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *         description: Conversation ID
   *       - in: query
   *         name: page
   *         schema:
   *           type: integer
   *           default: 1
   *           minimum: 1
   *         description: Page number
   *       - in: query
   *         name: limit
   *         schema:
   *           type: integer
   *           default: 50
   *           minimum: 1
   *           maximum: 100
   *         description: Number of messages per page
   *     responses:
   *       200:
   *         description: Conversation with paginated chat messages
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 id:
   *                   type: string
   *                 title:
   *                   type: string
   *                 chats:
   *                   type: array
   *                   items:
   *                     type: object
   *                 pagination:
   *                   type: object
   *                   properties:
   *                     page:
   *                       type: integer
   *                     limit:
   *                       type: integer
   *                     total:
   *                       type: integer
   *                     totalPages:
   *                       type: integer
   *       401:
   *         description: Unauthorized
   *       404:
   *         description: Conversation not found
   */
  fastify.get("/:id", { preHandler: fastifyRequireAuth }, async (request, reply) => {
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

  /**
   * @openapi
   * /api/history/{id}:
   *   patch:
   *     tags:
   *       - History
   *     summary: Rename a conversation
   *     description: Update the title of an existing conversation owned by the authenticated user.
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *         description: Conversation ID
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required:
   *               - title
   *             properties:
   *               title:
   *                 type: string
   *     responses:
   *       200:
   *         description: Conversation renamed successfully
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 success:
   *                   type: boolean
   *                 title:
   *                   type: string
   *       401:
   *         description: Unauthorized
   *       404:
   *         description: Conversation not found
   */
  fastify.patch("/:id", { preHandler: [fastifyRequireAuth, fastifyValidate(renameConversationSchema)] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { title } = request.body as { title: string };

    const updated = await updateConversationTitle(id, request.userId!, title);
    if (!updated) throw new AppError(404, "Conversation not found");
    return { success: true, title };
  });

  /**
   * @openapi
   * /api/history/{id}:
   *   delete:
   *     tags:
   *       - History
   *     summary: Delete a conversation
   *     description: Permanently delete a conversation and its messages.
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *         description: Conversation ID
   *     responses:
   *       200:
   *         description: Conversation deleted successfully
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 success:
   *                   type: boolean
   *       401:
   *         description: Unauthorized
   *       404:
   *         description: Conversation not found
   */
  fastify.delete("/:id", { preHandler: fastifyRequireAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const deleted = await deleteConversation(id, request.userId!);
    if (!deleted) throw new AppError(404, "Conversation not found");
    return { success: true };
  });

  /**
   * @openapi
   * /api/history/{id}/fork:
   *   post:
   *     tags:
   *       - History
   *     summary: Fork a conversation
   *     description: Create a new conversation by copying messages up to a specified chat ID from an existing conversation.
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *         description: Source conversation ID
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required:
   *               - toChatId
   *             properties:
   *               toChatId:
   *                 type: integer
   *                 description: ID of the last chat message to include in the fork
   *     responses:
   *       200:
   *         description: Conversation forked successfully
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 success:
   *                   type: boolean
   *                 forkId:
   *                   type: string
   *                 count:
   *                   type: integer
   *       400:
   *         description: No messages to fork
   *       401:
   *         description: Unauthorized
   *       404:
   *         description: Source conversation not found
   */
  fastify.post("/:id/fork", { preHandler: [fastifyRequireAuth, fastifyValidate(forkSchema)] }, async (request, reply) => {
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

  /**
   * @openapi
   * /api/history/shared/{id}:
   *   get:
   *     tags:
   *       - History
   *     summary: Get a shared conversation
   *     description: Retrieve a publicly shared conversation by its ID. No authentication required.
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *         description: Conversation ID
   *     responses:
   *       200:
   *         description: Public conversation with all chat messages
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 id:
   *                   type: string
   *                 title:
   *                   type: string
   *                 isPublic:
   *                   type: boolean
   *                 chats:
   *                   type: array
   *                   items:
   *                     type: object
   *       404:
   *         description: Public conversation not found
   */
  fastify.get("/shared/:id", async (request, reply) => {
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

  /**
   * @openapi
   * /api/history/{id}/share:
   *   patch:
   *     tags:
   *       - History
   *     summary: Toggle conversation sharing
   *     description: Set a conversation's public sharing status.
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *         description: Conversation ID
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required:
   *               - isPublic
   *             properties:
   *               isPublic:
   *                 type: boolean
   *     responses:
   *       200:
   *         description: Sharing status updated
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 success:
   *                   type: boolean
   *                 isPublic:
   *                   type: boolean
   *       400:
   *         description: isPublic must be a boolean
   *       401:
   *         description: Unauthorized
   *       404:
   *         description: Conversation not found
   */
  fastify.patch("/:id/share", { preHandler: fastifyRequireAuth }, async (request, reply) => {
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

  fastify.get("/:id/summary", { preHandler: fastifyRequireAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const userId = request.userId!;

    try {
      const conv = await findConversationById(id, userId);
      if (!conv) {
        throw new AppError(404, "Conversation not found");
      }
      return (conv as any).summaryData || null;
    } catch (err) {
      if (err instanceof AppError) throw err;
      logger.error({ err, id }, "Failed to fetch summary");
      throw new AppError(500, "Internal server error");
    }
  });

  fastify.post("/:id/summary", { preHandler: fastifyRequireAuth }, async (request, reply) => {
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
