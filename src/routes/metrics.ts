import { Router, Response } from "express";
import prisma from "../lib/db.js";
import { requireAuth } from "../middleware/auth.js";
import { AuthRequest } from "../types/index.js";

const router = Router();

// ── GET /api/metrics — User-scoped metrics ──────────────────────────────────
router.get("/", requireAuth, async (req: AuthRequest, res: Response, next) => {
  try {
    const userId = req.userId!;

    // 1. Total Requests/Chats (user-scoped)
    const totalChats = await prisma.chat.count({ where: { userId } });
    
    // 2. Cache Performance (user-scoped)
    const cacheHits = await prisma.chat.count({ where: { userId, cacheHit: true } });
    const cacheHitRate = totalChats === 0 ? 0 : (cacheHits / totalChats) * 100;
    
    // 3. Token Usage & Latency Aggregates (user-scoped)
    const stats = await prisma.chat.aggregate({
      where: { userId },
      _sum: { tokensUsed: true },
      _avg: { durationMs: true }
    });

    // 4. Conversation count
    const totalConversations = await prisma.conversation.count({ where: { userId } });

    res.json({
      success: true,
      metrics: {
        totalRequests: totalChats,
        totalConversations,
        cache: {
          hits: cacheHits,
          hitRatePercentage: parseFloat(cacheHitRate.toFixed(2))
        },
        performance: {
          averageLatencyMs: stats._avg.durationMs ? Math.round(stats._avg.durationMs) : 0,
          totalTokensUsed: stats._sum.tokensUsed || 0
        }
      }
    });
  } catch (error) {
    next(error);
  }
});

// ── GET /api/metrics/usage — Daily usage history (last 30 days) ─────────────
router.get("/usage", requireAuth, async (req: AuthRequest, res: Response, next) => {
  try {
    const userId = req.userId!;
    const daysBack = Math.min(Number(req.query.days) || 30, 90);
    const since = new Date();
    since.setUTCDate(since.getUTCDate() - daysBack);
    since.setUTCHours(0, 0, 0, 0);

    const usage = await prisma.dailyUsage.findMany({
      where: { userId, date: { gte: since } },
      orderBy: { date: "asc" },
      select: { date: true, requests: true, tokens: true }
    });

    res.json({ success: true, usage });
  } catch (error) {
    next(error);
  }
});

export default router;
