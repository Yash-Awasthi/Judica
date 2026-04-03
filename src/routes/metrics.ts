import { Router, Request, Response } from "express";
import prisma from "../lib/db.js";
import logger from "../lib/logger.js";
import { requireAuth } from "../middleware/auth.js";
import { AuthRequest } from "../types/index.js";

const router = Router();

// ── Get user's usage metrics ──────────────────────────────────────────────────
router.get("/usage", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const { days = "30" } = req.query;
    const daysNum = parseInt(days as string, 10) || 30;

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - daysNum);

    // Get daily usage
    const dailyUsage = await prisma.dailyUsage.findMany({
      where: {
        userId,
        date: {
          gte: cutoff,
        },
      },
      orderBy: { date: "asc" },
    });

    // Get total chats
    const totalChats = await prisma.chat.count({
      where: {
        userId,
        createdAt: {
          gte: cutoff,
        },
      },
    });

    // Get total tokens
    const tokenResult = await prisma.chat.aggregate({
      where: {
        userId,
        createdAt: {
          gte: cutoff,
        },
      },
      _sum: {
        tokensUsed: true,
      },
    });

    // Get average duration
    const durationResult = await prisma.chat.aggregate({
      where: {
        userId,
        createdAt: {
          gte: cutoff,
        },
        durationMs: {
          not: null,
        },
      },
      _avg: {
        durationMs: true,
      },
    });

    res.json({
      period: {
        days: daysNum,
        from: cutoff.toISOString(),
        to: new Date().toISOString(),
      },
      summary: {
        totalChats,
        totalTokens: tokenResult._sum.tokensUsed || 0,
        avgDurationMs: Math.round(durationResult._avg.durationMs || 0),
      },
      daily: dailyUsage.map((d: { date: Date; requests: number; tokens: number }) => ({
        date: d.date.toISOString().split("T")[0],
        requests: d.requests,
        tokens: d.tokens,
      })),
    });
  } catch (err) {
    logger.error({ err: (err as Error).message }, "Failed to get usage metrics");
    res.status(500).json({ error: "Failed to get usage metrics" });
  }
});

// ── Get system-wide metrics (admin only) ──────────────────────────────────────
router.get("/system", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    // TODO: Add admin check
    const userId = req.userId!;

    // Get total users
    const totalUsers = await prisma.user.count();

    // Get total conversations
    const totalConversations = await prisma.conversation.count();

    // Get total chats
    const totalChats = await prisma.chat.count();

    // Get total tokens used
    const tokenResult = await prisma.chat.aggregate({
      _sum: {
        tokensUsed: true,
      },
    });

    // Get recent activity (last 24 hours)
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);

    const recentChats = await prisma.chat.count({
      where: {
        createdAt: {
          gte: yesterday,
        },
      },
    });

    res.json({
      totalUsers,
      totalConversations,
      totalChats,
      totalTokens: tokenResult._sum.tokensUsed || 0,
      recentActivity: {
        chatsLast24h: recentChats,
      },
    });
  } catch (err) {
    logger.error({ err: (err as Error).message }, "Failed to get system metrics");
    res.status(500).json({ error: "Failed to get system metrics" });
  }
});

// ── Get conversation metrics ──────────────────────────────────────────────────
router.get("/conversation/:id", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const { id } = req.params;

    const conversation = await prisma.conversation.findFirst({
      where: {
        id: String(id),
        userId,
      },
      include: {
        chats: {
          select: {
            tokensUsed: true,
            durationMs: true,
            createdAt: true,
          },
        },
      },
    }) as { id: string; title: string; createdAt: Date; updatedAt: Date; chats: { tokensUsed: number | null; durationMs: number | null; createdAt: Date }[] } | null;

    if (!conversation) {
      return res.status(404).json({ error: "Conversation not found" });
    }

    const totalTokens = conversation.chats.reduce((sum: number, c: { tokensUsed: number | null }) => sum + (c.tokensUsed || 0), 0);
    const avgDuration = conversation.chats.length > 0
      ? conversation.chats.reduce((sum: number, c: { durationMs: number | null }) => sum + (c.durationMs || 0), 0) / conversation.chats.length
      : 0;

    res.json({
      conversationId: id,
      title: conversation.title,
      totalChats: conversation.chats.length,
      totalTokens,
      avgDurationMs: Math.round(avgDuration),
      createdAt: conversation.createdAt,
      updatedAt: conversation.updatedAt,
    });
  } catch (err) {
    logger.error({ err: (err as Error).message }, "Failed to get conversation metrics");
    res.status(500).json({ error: "Failed to get conversation metrics" });
  }
});

export default router;