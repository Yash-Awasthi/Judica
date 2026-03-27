import { Router, Response } from "express";
import prisma from "../lib/db.js";
import { requireAuth, optionalAuth, AuthRequest } from "../middleware/auth.js";
import { AppError } from "../middleware/errorHandler.js";

const router = Router();

// ── GET /history ────────────────────────────────────────
router.get("/", optionalAuth, async (req: AuthRequest, res: Response, next) => {
  try {
    if (!req.userId) { res.json([]); return; }

    const chats = await prisma.chat.findMany({
      where: { userId: req.userId },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: {
        id: true,
        question: true,
        verdict: true,
        opinions: true,
        createdAt: true,
      },
    });

    res.json(chats);
  } catch (e) {
    next(e);
  }
});

// ── GET /history/:id ────────────────────────────────────
router.get("/:id", requireAuth, async (req: AuthRequest, res: Response, next) => {
  try {
    const chat = await prisma.chat.findFirst({
      where: {
        id: Number(req.params.id),
        userId: req.userId,
      },
    });

    if (!chat) throw new AppError(404, "Chat not found");
    res.json(chat);
  } catch (e) {
    next(e);
  }
});

// ── DELETE /history/:id ─────────────────────────────────
router.delete("/:id", requireAuth, async (req: AuthRequest, res: Response, next) => {
  try {
    const chat = await prisma.chat.findFirst({
      where: { id: Number(req.params.id), userId: req.userId },
    });

    if (!chat) throw new AppError(404, "Chat not found or not yours");

    await prisma.chat.delete({ where: { id: Number(req.params.id) } });
    res.json({ success: true });
  } catch (e) {
    next(e);
  }
});

// ── DELETE /history (clear all) ─────────────────────────
router.delete("/", requireAuth, async (req: AuthRequest, res: Response, next) => {
  try {
    await prisma.chat.deleteMany({ where: { userId: req.userId } });
    res.json({ success: true });
  } catch (e) {
    next(e);
  }
});

export default router;