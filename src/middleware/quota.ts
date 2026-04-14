import { Response, NextFunction } from "express";
import type { FastifyRequest, FastifyReply } from "fastify";
import { db } from "../lib/drizzle.js";
import { dailyUsage } from "../db/schema/users.js";
import { eq, and, sql } from "drizzle-orm";
import { AuthRequest } from "../types/index.js";
import logger from "../lib/logger.js";
import { DAILY_REQUEST_LIMIT, DAILY_TOKEN_LIMIT } from "../config/quotas.js";

const MAX_DAILY_REQUESTS = DAILY_REQUEST_LIMIT;
const MAX_DAILY_TOKENS = DAILY_TOKEN_LIMIT;

export async function checkQuota(req: AuthRequest, res: Response, next: NextFunction) {
  if (!req.userId) {
    return next();
  }

  try {
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);

    const existing = await db
      .select()
      .from(dailyUsage)
      .where(and(eq(dailyUsage.userId, req.userId), eq(dailyUsage.date, today)))
      .limit(1);

    const currentRequests = existing[0]?.requests ?? 0;
    const currentTokens = existing[0]?.tokens ?? 0;

    if (currentRequests >= MAX_DAILY_REQUESTS || currentTokens >= MAX_DAILY_TOKENS) {
      logger.warn({
        userId: req.userId,
        requests: currentRequests,
        tokens: currentTokens,
        requestId: (req as any).requestId
      }, "User exceeded daily quota limit");
      res.setHeader("X-Quota-Limit", MAX_DAILY_REQUESTS.toString());
      res.setHeader("X-Quota-Used", currentRequests.toString());
      res.setHeader("X-Token-Limit", MAX_DAILY_TOKENS.toString());
      res.setHeader("X-Token-Used", currentTokens.toString());
      res.setHeader("Retry-After", "86400");
      res.status(429).json({ error: "Daily request or token quota exceeded. Please try again tomorrow." });
      return;
    }

    const [updatedUsage] = await db
      .insert(dailyUsage)
      .values({
        userId: req.userId,
        date: today,
        requests: 1,
        tokens: 0,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [dailyUsage.userId, dailyUsage.date],
        set: {
          requests: sql`${dailyUsage.requests} + 1`,
          updatedAt: new Date(),
        },
      })
      .returning();

    res.setHeader("X-Quota-Limit", MAX_DAILY_REQUESTS.toString());
    res.setHeader("X-Quota-Used", updatedUsage.requests.toString());
    res.setHeader("X-Quota-Remaining", Math.max(0, MAX_DAILY_REQUESTS - updatedUsage.requests).toString());

    res.setHeader("X-Token-Limit", MAX_DAILY_TOKENS.toString());
    res.setHeader("X-Token-Used", updatedUsage.tokens.toString());
    res.setHeader("X-Token-Remaining", Math.max(0, MAX_DAILY_TOKENS - updatedUsage.tokens).toString());

    next();
  } catch (e) {
    next(e);
  }
}

// ---------- Fastify-native version ----------

export async function fastifyCheckQuota(request: FastifyRequest, reply: FastifyReply) {
  const userId = (request as any).userId;
  if (!userId) return;

  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  const existing = await db
    .select()
    .from(dailyUsage)
    .where(and(eq(dailyUsage.userId, userId), eq(dailyUsage.date, today)))
    .limit(1);

  const currentRequests = existing[0]?.requests ?? 0;
  const currentTokens = existing[0]?.tokens ?? 0;

  if (currentRequests >= MAX_DAILY_REQUESTS || currentTokens >= MAX_DAILY_TOKENS) {
    logger.warn({
      userId,
      requests: currentRequests,
      tokens: currentTokens,
      requestId: (request as any).requestId
    }, "User exceeded daily quota limit");
    reply.header("X-Quota-Limit", MAX_DAILY_REQUESTS.toString());
    reply.header("X-Quota-Used", currentRequests.toString());
    reply.header("X-Token-Limit", MAX_DAILY_TOKENS.toString());
    reply.header("X-Token-Used", currentTokens.toString());
    reply.header("Retry-After", "86400");
    reply.code(429).send({ error: "Daily request or token quota exceeded. Please try again tomorrow." });
    return;
  }

  const [updatedUsage] = await db
    .insert(dailyUsage)
    .values({
      userId,
      date: today,
      requests: 1,
      tokens: 0,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [dailyUsage.userId, dailyUsage.date],
      set: {
        requests: sql`${dailyUsage.requests} + 1`,
        updatedAt: new Date(),
      },
    })
    .returning();

  reply.header("X-Quota-Limit", MAX_DAILY_REQUESTS.toString());
  reply.header("X-Quota-Used", updatedUsage.requests.toString());
  reply.header("X-Quota-Remaining", Math.max(0, MAX_DAILY_REQUESTS - updatedUsage.requests).toString());

  reply.header("X-Token-Limit", MAX_DAILY_TOKENS.toString());
  reply.header("X-Token-Used", updatedUsage.tokens.toString());
  reply.header("X-Token-Remaining", Math.max(0, MAX_DAILY_TOKENS - updatedUsage.tokens).toString());
}
