import { Router, Request, Response } from "express";
import { requireAuth } from "../middleware/auth.js";
import { AuthRequest } from "../types/index.js";
import {
  getConversationList,
  deleteConversation,
  updateConversationTitle
} from "../services/conversationService.js";
import prisma from "../lib/db.js";
import logger from "../lib/logger.js";

import { AppError } from "../middleware/errorHandler.js";
import { validate, renameConversationSchema, forkSchema } from "../middleware/validate.js";

const router = Router();

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
router.get("/search", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { q, limit = "10" } = req.query;

    if (!q || typeof q !== "string" || q.trim().length < 2) {
      return res.json([]);
    }

    const searchTerm = q.trim();
    const limitNum = Math.min(Math.max(parseInt(limit as string, 10) || 10, 1), 50);

    const results = await prisma.chat.findMany({
      where: {
        userId: req.userId!,
        OR: [
          { question: { contains: searchTerm, mode: "insensitive" } },
          { verdict: { contains: searchTerm, mode: "insensitive" } }
        ]
      },
      orderBy: { createdAt: "desc" },
      take: limitNum,
      select: {
        id: true,
        conversationId: true,
        question: true,
        verdict: true,
        createdAt: true
      }
    });

    res.json(results);
  } catch (err) {
    logger.error({ err, userId: req.userId }, "History search failed");
    res.json([]);
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
router.get("/", requireAuth, async (req: AuthRequest, res: Response, next) => {
  try {
    const { page, limit, skip } = parsePagination(req.query);

    const [conversations, total] = await Promise.all([
      getConversationList(req.userId!, limit),
      prisma.conversation.count({ where: { userId: req.userId! } })
    ]);

    res.json({
      data: conversations,
      pagination: paginationMeta(page, limit, total)
    });
  } catch (e) {
    next(e);
  }
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
router.get("/:id", requireAuth, async (req: AuthRequest, res: Response, next) => {
  try {
    const { id } = req.params;
    const { page, limit, skip } = parsePagination(req.query, 50);

    const conversation = await prisma.conversation.findFirst({
      where: { id: id as string, userId: req.userId! },
      include: { Chat: {
          orderBy: { createdAt: "asc" },
          skip,
          take: limit,
        },
        _count: { select: { Chat: true } }
      }
    });

    if (!conversation) {
      throw new AppError(404, "Conversation not found");
    }

    const totalChats = (conversation as { _count: { Chat: number } })._count.Chat;

    res.json({
      ...conversation,
      pagination: paginationMeta(page, limit, totalChats)
    });
  } catch (e) {
    next(e);
  }
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
router.patch("/:id", requireAuth, validate(renameConversationSchema), async (req: AuthRequest, res: Response, next) => {
  try {
    const { id } = req.params;
    const { title } = req.body;

    const updated = await updateConversationTitle(id as string, req.userId!, title as string);
    if (!updated) throw new AppError(404, "Conversation not found");
    res.json({ success: true, title });
  } catch (e) {
    next(e);
  }
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
router.delete("/:id", requireAuth, async (req: AuthRequest, res: Response, next) => {
  try {
    const { id } = req.params;
    const deleted = await deleteConversation(id as string, req.userId!);
    if (!deleted) throw new AppError(404, "Conversation not found");
    res.json({ success: true });
  } catch (e) {
    next(e);
  }
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
router.post("/:id/fork", requireAuth, validate(forkSchema), async (req: AuthRequest, res: Response, next) => {
  try {
    const { id } = req.params;
    const { toChatId } = req.body;

    const source = await prisma.conversation.findFirst({
      where: { id: id as string, userId: req.userId! },
      include: { Chat: { orderBy: { createdAt: "asc" } } }
    });

    if (!source) throw new AppError(404, "Source conversation not found");

    const chatsToFork = (source as { Chat: Array<{ id: number }> }).Chat.filter((c: { id: number }) => c.id <= Number(toChatId));
    if (!chatsToFork.length) throw new AppError(400, "No messages to fork");

    const fork = await prisma.conversation.create({
      data: {
        userId: req.userId!,
        title: `Fork of: ${source.title}`,
      } as any
    });

    await prisma.chat.createMany({
      data: chatsToFork.map((c) => ({
        userId: req.userId!,
        conversationId: fork.id,
        question: (c as any).question,
        verdict: (c as any).verdict,
        opinions: (c as any).opinions,
      }))
    });

    res.json({ success: true, forkId: fork.id, count: chatsToFork.length });
  } catch (e) {
    next(e);
  }
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
router.get("/shared/:id", async (req: Request, res: Response, next) => {
  try {
    const { id } = req.params;
    const conversation = await prisma.conversation.findFirst({
      where: { id: id as string, isPublic: true },
      include: { Chat: { orderBy: { createdAt: "asc" } } }
    });

    if (!conversation) {
      throw new AppError(404, "Public conversation not found");
    }

    res.json(conversation);
  } catch (e) {
    next(e);
  }
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
router.patch("/:id/share", requireAuth, async (req: AuthRequest, res: Response, next) => {
  try {
    const { id } = req.params;
    const { isPublic } = req.body;

    if (typeof isPublic !== "boolean") {
      throw new AppError(400, "isPublic must be a boolean");
    }

    const updated = await prisma.conversation.updateMany({
      where: { id: id as string, userId: req.userId! },
      data: { isPublic }
    });

    if (updated.count === 0) throw new AppError(404, "Conversation not found");
    res.json({ success: true, isPublic });
  } catch (e) {
    next(e);
  }
});

export default router;