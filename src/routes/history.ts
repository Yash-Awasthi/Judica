import { Router, Request, Response } from "express";
import { requireAuth } from "../middleware/auth.js";
import { AuthRequest } from "../types/index.js";
import prisma from "../lib/db.js";

import { AppError } from "../middleware/errorHandler.js";
import { validate, renameConversationSchema, forkSchema } from "../middleware/validate.js";

const router = Router();

// ── Pagination helper ─────────────────────────────────────────────────────────
function parsePagination(query: any, defaultLimit = 20, maxLimit = 100) {
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const limit = Math.min(maxLimit, Math.max(1, parseInt(query.limit, 10) || defaultLimit));
  const skip = (page - 1) * limit;
  return { page, limit, skip };
}

function paginationMeta(page: number, limit: number, total: number) {
  return { page, limit, total, totalPages: Math.ceil(total / limit) };
}

// ── GET /history — Lists conversations (paginated) ──────────────────────────
router.get("/", requireAuth, async (req: AuthRequest, res: Response, next) => {
  try {
    const { page, limit, skip } = parsePagination(req.query);

    const [conversations, total] = await Promise.all([
      prisma.conversation.findMany({
        where: { userId: req.userId! },
        orderBy: { updatedAt: "desc" },
        include: { _count: { select: { chats: true } } },
        skip,
        take: limit,
      }),
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

// ── GET /history/:id — Fetches conversation with paginated chats ────────────
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

    const totalChats = (conversation as any)._count.chats;

    res.json({
      ...conversation,
      pagination: paginationMeta(page, limit, totalChats)
    });
  } catch (e) {
    next(e);
  }
});

// ── PATCH /history/:id — Renames a conversation ─────────────────────────────
router.patch("/:id", requireAuth, validate(renameConversationSchema), async (req: AuthRequest, res: Response, next) => {
  try {
    const { id } = req.params;
    const { title } = req.body;

    const updated = await prisma.conversation.updateMany({
      where: { id: id as string, userId: req.userId! },
      data: { title }
    });

    if (updated.count === 0) throw new AppError(404, "Conversation not found");
    res.json({ success: true, title });
  } catch (e) {
    next(e);
  }
});

// ── DELETE /history/:id — Deletes a conversation ────────────────────────────
router.delete("/:id", requireAuth, async (req: AuthRequest, res: Response, next) => {
  try {
    const { id } = req.params;
    const deleted = await prisma.conversation.deleteMany({
      where: { id: id as string, userId: req.userId! }
    });

    if (deleted.count === 0) throw new AppError(404, "Conversation not found");
    res.json({ success: true });
  } catch (e) {
    next(e);
  }
});

// ── POST /history/:id/fork — Clones a conversation up to a specific chat ────
router.post("/:id/fork", requireAuth, validate(forkSchema), async (req: AuthRequest, res: Response, next) => {
  try {
    const { id } = req.params;
    const { toChatId } = req.body;

    const source = await prisma.conversation.findFirst({
      where: { id: id as string, userId: req.userId! },
      include: { chats: { orderBy: { createdAt: "asc" } } }
    });

    if (!source) throw new AppError(404, "Source conversation not found");

    // Filter chats up to the requested ID
    const chatsToFork = (source as any).chats.filter((c: any) => c.id <= toChatId);
    if (!chatsToFork.length) throw new AppError(400, "No messages to fork");

    const fork = await prisma.conversation.create({
      data: {
        userId: req.userId!,
        title: `Fork of: ${source.title}`,
      }
    });

    await prisma.chat.createMany({
      data: chatsToFork.map((c: any) => ({
        userId: req.userId!,
        conversationId: fork.id,
        question: c.question,
        verdict: c.verdict,
        opinions: c.opinions,
      }))
    });

    res.json({ success: true, forkId: fork.id, count: chatsToFork.length });
  } catch (e) {
    next(e);
  }
});

// ── GET /history/shared/:id — Fetches a public conversation without auth ────
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

// ── PATCH /history/:id/share — Toggles public visibility ────────────────────
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