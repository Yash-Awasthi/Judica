import { FastifyPluginAsync, FastifyRequest, FastifyReply } from "fastify";
import { db } from "../lib/drizzle.js";
import { dailyUsage, users } from "../db/schema/users.js";
import { conversations, chats } from "../db/schema/conversations.js";
import { eq, and, gte, count, sum, avg, asc, isNotNull } from "drizzle-orm";
import logger from "../lib/logger.js";
import { AppError } from "../middleware/errorHandler.js";
import { fastifyRequireAuth } from "../middleware/fastifyAuth.js";

async function fastifyRequireAdmin(request: FastifyRequest, reply: FastifyReply) {
  await fastifyRequireAuth(request, reply);
  if (reply.sent) return;

  if (!request.userId) {
    reply.code(401).send({ error: "Not authenticated" });
    return;
  }

  const [user] = await db
    .select({ role: users.role })
    .from(users)
    .where(eq(users.id, request.userId))
    .limit(1);

  if (!user || user.role !== "admin") {
    reply.code(403).send({ error: "Admin access required" });
    return;
  }
}

// ─── Plugin ─────────────────────────────────────────────────────────────────

const metricsPlugin: FastifyPluginAsync = async (fastify) => {
    fastify.get("/usage", { preHandler: fastifyRequireAuth }, async (request: FastifyRequest, _reply) => {
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

    fastify.get("/system", { preHandler: fastifyRequireAdmin }, async (_request: FastifyRequest, _reply) => {
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

    fastify.get("/conversation/:id", { preHandler: fastifyRequireAuth }, async (request: FastifyRequest, reply) => {
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
        title: (conversation as unknown as { title?: string }).title,
        totalChats: chatRows.length,
        totalTokens,
        avgDurationMs: Math.round(avgDuration),
        createdAt: (conversation as unknown as { createdAt?: Date }).createdAt,
        updatedAt: (conversation as unknown as { updatedAt?: Date }).updatedAt,
      };
    } catch (err) {
      logger.error({ err: (err as Error).message }, "Failed to get conversation metrics");
      throw new AppError(500, "Failed to get conversation metrics", "CONVERSATION_METRICS_FETCH_FAILED");
    }
  });
};

export default metricsPlugin;
