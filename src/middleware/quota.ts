import { Response, NextFunction } from "express";
import prisma from "../lib/db.js";
import { AuthRequest } from "../types/index.js";
import logger from "../lib/logger.js";
import { DAILY_REQUEST_LIMIT, DAILY_TOKEN_LIMIT } from "../config/quotas.js";

const MAX_DAILY_REQUESTS = DAILY_REQUEST_LIMIT;
const MAX_DAILY_TOKENS = DAILY_TOKEN_LIMIT;

export async function checkQuota(req: AuthRequest, res: Response, next: NextFunction) {
  if (!req.userId) {
    // Guest handling is naturally mitigated by IP rate limits elsewhere.
    return next();
  }

  try {
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);

    // Atomic increment of today's usage using Prisma's upsert
    const updatedUsage = await prisma.dailyUsage.upsert({
      where: { userId_date: { userId: req.userId, date: today } },
      update: { requests: { increment: 1 } },
      create: { userId: req.userId, date: today, requests: 1 },
    });

    if (updatedUsage.requests > MAX_DAILY_REQUESTS || updatedUsage.tokens > MAX_DAILY_TOKENS) {
      logger.warn({
        userId: req.userId,
        requests: updatedUsage.requests,
        tokens: updatedUsage.tokens,
        requestId: (req as any).requestId
      }, "User exceeded daily quota limit");
      res.setHeader("X-Quota-Limit", MAX_DAILY_REQUESTS.toString());
      res.setHeader("X-Quota-Used", updatedUsage.requests.toString());
      res.setHeader("X-Token-Limit", MAX_DAILY_TOKENS.toString());
      res.setHeader("X-Token-Used", updatedUsage.tokens.toString());
      res.setHeader("Retry-After", "86400");
      res.status(429).json({ error: "Daily request or token quota exceeded. Please try again tomorrow." });
      return;
    }

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
