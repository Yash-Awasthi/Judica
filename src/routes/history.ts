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

router.get("/search", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { q, limit = "20", page = "1" } = req.query;

    if (!q || typeof q !== "string" || q.trim().length < 2) {
      return res.json({ data: [], pagination: { total: 0, page: 1, limit: 20, totalPages: 0 } });
    }

    const searchTerm = q.trim();
    const { limit: limitNum, skip, page: pageNum } = parsePagination({ limit: limit as string, page: page as string }, 20, 50);

    const whereClause = {
      userId: req.userId!,
      OR: [
        { question: { contains: searchTerm, mode: "insensitive" as const } },
        { verdict: { contains: searchTerm, mode: "insensitive" as const } }
      ]
    };

    const [rawResults, total] = await Promise.all([
      prisma.chat.findMany({
        where: whereClause,
        orderBy: { createdAt: "desc" },
        take: limitNum,
        skip: skip,
        include: {
          Conversation: {
            select: { title: true }
          }
        }
      }),
      prisma.chat.count({ where: whereClause })
    ]);

    const highlightText = (text: string, term: string) => {
      if (!text) return "";
      const regex = new RegExp(`(${term})`, "gi");
      return text.replace(regex, "<mark>$1</mark>");
    };

    const formattedResults = rawResults.map((chat: any) => {
      const qMatch = chat.question && chat.question.toLowerCase().includes(searchTerm.toLowerCase());
      const vMatch = chat.verdict && chat.verdict.toLowerCase().includes(searchTerm.toLowerCase());

      const score = (qMatch && vMatch) ? 0.95 : qMatch ? 0.8 : vMatch ? 0.6 : 0.4;





      return {
        id: chat.id.toString(),
        question: chat.question,
        verdict: chat.verdict,
        conversationId: chat.conversationId,
        conversationTitle: chat.Conversation?.title || "Unknown Conversation",
        createdAt: chat.createdAt.toISOString(),
        relevanceScore: score,
        highlights: {
          question: qMatch ? highlightText(chat.question, searchTerm) : chat.question,
          verdict: vMatch ? highlightText((chat.verdict?.slice(0, 300) || "") + (chat.verdict?.length > 300 ? "..." : ""), searchTerm) : (chat.verdict?.slice(0, 300) || "") + (chat.verdict?.length > 300 ? "..." : ""),
          hasOpinionMatch: false
        }
      };
    });

    res.json({
      data: formattedResults,
      pagination: { page: pageNum, limit: limitNum, total, totalPages: Math.ceil(total / limitNum) }
    });
  } catch (err) {
    logger.error({ err, userId: req.userId }, "History search failed");
    res.json({ data: [], pagination: { total: 0, page: 1, limit: 20, totalPages: 0 } });
  }
});

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

router.get("/:id", requireAuth, async (req: AuthRequest, res: Response, next) => {
  try {
    const { id } = req.params;
    const { page, limit, skip } = parsePagination(req.query, 50);

    const conversation = await prisma.conversation.findFirst({
      where: { id: id as string, userId: req.userId! },
      include: {
        chats: {
          orderBy: { createdAt: "asc" },
          skip,
          take: limit,
        },
        _count: { select: { chats: true } }
      }
    });

    if (!conversation) {
      throw new AppError(404, "Conversation not found");
    }

    const totalChats = (conversation as { _count: { chats: number } })._count.chats;

    res.json({
      ...conversation,
      pagination: paginationMeta(page, limit, totalChats)
    });
  } catch (e) {
    next(e);
  }
});

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

router.post("/:id/fork", requireAuth, validate(forkSchema), async (req: AuthRequest, res: Response, next) => {
  try {
    const { id } = req.params;
    const { toChatId } = req.body;

    const source = await prisma.conversation.findFirst({
      where: { id: id as string, userId: req.userId! },
      include: { chats: { orderBy: { createdAt: "asc" } } }
    });

    if (!source) throw new AppError(404, "Source conversation not found");

    const chatsToFork = (source as { chats: Array<{ id: number }> }).chats.filter((c: { id: number }) => c.id <= Number(toChatId));
    if (!chatsToFork.length) throw new AppError(400, "No messages to fork");

    const fork = await prisma.conversation.create({
      data: {
        userId: req.userId!,
        title: `Fork of: ${source.title}`,
      }
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

router.get("/shared/:id", async (req: Request, res: Response, next) => {
  try {
    const { id } = req.params;
    const conversation = await prisma.conversation.findFirst({
      where: { id: id as string, isPublic: true },
      include: { chats: { orderBy: { createdAt: "asc" } } }
    });

    if (!conversation) {
      throw new AppError(404, "Public conversation not found");
    }

    res.json(conversation);
  } catch (e) {
    next(e);
  }
});

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