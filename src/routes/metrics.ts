import { FastifyPluginAsync } from "fastify";
import { db } from "../lib/drizzle.js";
import { dailyUsage, users } from "../db/schema/users.js";
import { conversations, chats } from "../db/schema/conversations.js";
import { eq, and, gte, count, sum, avg, asc, isNotNull } from "drizzle-orm";
import logger from "../lib/logger.js";
import { AppError } from "../middleware/errorHandler.js";
import { fastifyRequireAuth } from "../middleware/fastifyAuth.js";

// ─── Plugin ─────────────────────────────────────────────────────────────────

const metricsPlugin: FastifyPluginAsync = async (fastify) => {
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
  fastify.get("/usage", { preHandler: fastifyRequireAuth }, async (request: any, reply) => {
    try {
      const userId = request.userId!;
      const { days = "30" } = request.query as { days?: string };
      const daysNum = parseInt(days as string, 10) || 30;

      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - daysNum);

      const dailyRows = await db
        .select()
        .from(dailyUsage)
        .where(and(eq(dailyUsage.userId, userId), gte(dailyUsage.date, cutoff)))
        .orderBy(asc(dailyUsage.date));

      const [totalChatsRow] = await db
        .select({ value: count() })
        .from(chats)
        .where(and(eq(chats.userId, userId), gte(chats.createdAt, cutoff)));

      const [tokenRow] = await db
        .select({ total: sum(chats.tokensUsed) })
        .from(chats)
        .where(and(eq(chats.userId, userId), gte(chats.createdAt, cutoff)));

      const [durationRow] = await db
        .select({ avgVal: avg(chats.durationMs) })
        .from(chats)
        .where(
          and(
            eq(chats.userId, userId),
            gte(chats.createdAt, cutoff),
            isNotNull(chats.durationMs),
          ),
        );

      return {
        period: {
          days: daysNum,
          from: cutoff.toISOString(),
          to: new Date().toISOString(),
        },
        summary: {
          totalChats: totalChatsRow.value,
          totalTokens: Number(tokenRow.total) || 0,
          avgDurationMs: Math.round(Number(durationRow.avgVal) || 0),
        },
        daily: dailyRows.map((d: { date: Date; requests: number; tokens: number }) => ({
          date: d.date.toISOString().split("T")[0],
          requests: d.requests,
          tokens: d.tokens,
        })),
      };
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
  fastify.get("/system", { preHandler: fastifyRequireAuth }, async (request: any, reply) => {
    try {
      const [totalUsersRow] = await db.select({ value: count() }).from(users);

      const [totalConversationsRow] = await db.select({ value: count() }).from(conversations);

      const [totalChatsRow] = await db.select({ value: count() }).from(chats);

      const [tokenRow] = await db.select({ total: sum(chats.tokensUsed) }).from(chats);

      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);

      const [recentChatsRow] = await db
        .select({ value: count() })
        .from(chats)
        .where(gte(chats.createdAt, yesterday));

      return {
        totalUsers: totalUsersRow.value,
        totalConversations: totalConversationsRow.value,
        totalChats: totalChatsRow.value,
        totalTokens: Number(tokenRow.total) || 0,
        recentActivity: {
          chatsLast24h: recentChatsRow.value,
        },
      };
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
  fastify.get("/conversation/:id", { preHandler: fastifyRequireAuth }, async (request: any, reply) => {
    try {
      const userId = request.userId!;
      const { id } = request.params as { id: string };

      // Fetch the conversation
      const [conversation] = await db
        .select()
        .from(conversations)
        .where(and(eq(conversations.id, String(id)), eq(conversations.userId, userId)));

      if (!conversation) {
        reply.code(404);
        return { error: "Conversation not found" };
      }

      // Fetch related chats for this conversation
      const chatRows = await db
        .select({
          tokensUsed: chats.tokensUsed,
          durationMs: chats.durationMs,
          createdAt: chats.createdAt,
        })
        .from(chats)
        .where(eq(chats.conversationId, String(id)));

      const totalTokens = chatRows.reduce((s, c) => s + (Number(c.tokensUsed) || 0), 0);
      const avgDuration =
        chatRows.length > 0
          ? chatRows.reduce((s, c) => s + (Number(c.durationMs) || 0), 0) / chatRows.length
          : 0;

      return {
        conversationId: id,
        title: (conversation as any).title,
        totalChats: chatRows.length,
        totalTokens,
        avgDurationMs: Math.round(avgDuration),
        createdAt: (conversation as any).createdAt,
        updatedAt: (conversation as any).updatedAt,
      };
    } catch (err) {
      logger.error({ err: (err as Error).message }, "Failed to get conversation metrics");
      throw new AppError(500, "Failed to get conversation metrics", "CONVERSATION_METRICS_FETCH_FAILED");
    }
  });
};

export default metricsPlugin;
