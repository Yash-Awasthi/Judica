import { Router, Request, Response } from "express";
import prisma from "../lib/db.js";
import logger from "../lib/logger.js";
import { requireAuth } from "../middleware/auth.js";
import { AuthRequest } from "../types/index.js";
import { AppError } from "../middleware/errorHandler.js";

const router = Router();

/**
 * @openapi
 * /api/metrics/usage:
 *   get:
 *     tags:
 *       - Analytics
 *     summary: Get usage metrics for the authenticated user
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: days
 *         schema:
 *           type: integer
 *           default: 30
 *         description: Number of days to look back
 *     responses:
 *       200:
 *         description: Usage metrics
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 period:
 *                   type: object
 *                   properties:
 *                     days:
 *                       type: integer
 *                     from:
 *                       type: string
 *                       format: date-time
 *                     to:
 *                       type: string
 *                       format: date-time
 *                 summary:
 *                   type: object
 *                   properties:
 *                     totalChats:
 *                       type: integer
 *                     totalTokens:
 *                       type: integer
 *                     avgDurationMs:
 *                       type: integer
 *                 daily:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       date:
 *                         type: string
 *                       requests:
 *                         type: integer
 *                       tokens:
 *                         type: integer
 *       401:
 *         description: Unauthorized
 */
router.get("/usage", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const { days = "30" } = req.query;
    const daysNum = parseInt(days as string, 10) || 30;

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - daysNum);

    const dailyUsage = await prisma.dailyUsage.findMany({
      where: {
        userId,
        date: {
          gte: cutoff,
        },
      },
      orderBy: { date: "asc" },
    });

    const totalChats = await prisma.chat.count({
      where: {
        userId,
        createdAt: {
          gte: cutoff,
        },
      },
    });

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
    throw new AppError(500, "Failed to get usage metrics", "USAGE_METRICS_FETCH_FAILED");
  }
});

/**
 * @openapi
 * /api/metrics/system:
 *   get:
 *     tags:
 *       - Analytics
 *     summary: Get system-wide metrics
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: System metrics
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 totalUsers:
 *                   type: integer
 *                 totalConversations:
 *                   type: integer
 *                 totalChats:
 *                   type: integer
 *                 totalTokens:
 *                   type: integer
 *                 recentActivity:
 *                   type: object
 *                   properties:
 *                     chatsLast24h:
 *                       type: integer
 *       401:
 *         description: Unauthorized
 */
router.get("/system", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId!;

    const totalUsers = await prisma.user.count();

    const totalConversations = await prisma.conversation.count();

    const totalChats = await prisma.chat.count();

    const tokenResult = await prisma.chat.aggregate({
      _sum: {
        tokensUsed: true,
      },
    });

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
    throw new AppError(500, "Failed to get system metrics", "SYSTEM_METRICS_FETCH_FAILED");
  }
});

/**
 * @openapi
 * /api/metrics/conversation/{id}:
 *   get:
 *     tags:
 *       - Analytics
 *     summary: Get metrics for a specific conversation
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Conversation ID
 *     responses:
 *       200:
 *         description: Conversation metrics
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 conversationId:
 *                   type: string
 *                 title:
 *                   type: string
 *                 totalChats:
 *                   type: integer
 *                 totalTokens:
 *                   type: integer
 *                 avgDurationMs:
 *                   type: integer
 *                 createdAt:
 *                   type: string
 *                   format: date-time
 *                 updatedAt:
 *                   type: string
 *                   format: date-time
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Conversation not found
 */
router.get("/conversation/:id", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const { id } = req.params;

    const conversation = await prisma.conversation.findFirst({
      where: {
        id: String(id),
        userId,
      },
      include: { Chat: {
          select: {
            tokensUsed: true,
            durationMs: true,
            createdAt: true,
          },
        },
      },
    }) as any;

    if (!conversation) {
      return res.status(404).json({ error: "Conversation not found" });
    }

    const totalTokens = conversation.Chat.reduce((sum: number, c: { tokensUsed: number | null }) => sum + (c.tokensUsed || 0), 0);
    const avgDuration = conversation.Chat.length > 0
      ? conversation.Chat.reduce((sum: number, c: { durationMs: number | null }) => sum + (c.durationMs || 0), 0) / conversation.Chat.length
      : 0;

    res.json({
      conversationId: id,
      title: conversation.title,
      totalChats: conversation.Chat.length,
      totalTokens,
      avgDurationMs: Math.round(avgDuration),
      createdAt: conversation.createdAt,
      updatedAt: conversation.updatedAt,
    });
  } catch (err) {
    logger.error({ err: (err as Error).message }, "Failed to get conversation metrics");
    throw new AppError(500, "Failed to get conversation metrics", "CONVERSATION_METRICS_FETCH_FAILED");
  }
});

export default router;
