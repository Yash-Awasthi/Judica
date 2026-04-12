import { Response, NextFunction } from "express";
import { AuthRequest } from "../types/index.js";
import logger from "../lib/logger.js";

interface UserLimitState {
  rpmCount: number;
  lastReset: number;
  concurrency: number;
}

/**
 * LIMITATION: In-memory rate limiting is not cluster-safe. In a multi-process
 * or multi-node deployment, each instance maintains its own map, so effective
 * limits are multiplied by the number of instances. For production clusters,
 * replace with a Redis-backed rate limiter.
 *
 * A MAX_MAP_SIZE cap and periodic cleanup interval are included below to
 * prevent unbounded memory growth from expired entries.
 */
const userLimits = new Map<number, UserLimitState>();
const MAX_MAP_SIZE = 100_000;

const MAX_RPM = 1000; // 1000 requests per minute per user
const MAX_CONCURRENCY = 100; // 100 simultaneous requests per user
const RPM_WINDOW = 60000; // 1 minute window

// Periodic cleanup: evict expired entries every 5 minutes
const CLEANUP_INTERVAL = 5 * 60 * 1000;
setInterval(() => {
  const now = Date.now();
  for (const [userId, state] of userLimits) {
    if (now - state.lastReset > RPM_WINDOW && state.concurrency === 0) {
      userLimits.delete(userId);
    }
  }
}, CLEANUP_INTERVAL).unref();

export function perUserLimiter(req: AuthRequest, res: Response, next: NextFunction) {
  const userId = req.userId;
  if (!userId) return next();

  let state = userLimits.get(userId);
  const now = Date.now();

  if (!state) {
    // Prevent unbounded map growth
    if (userLimits.size >= MAX_MAP_SIZE) {
      logger.warn("Per-user rate limit map reached max size; rejecting new user");
      res.status(429).json({ error: "Server is busy. Please try again later." });
      return;
    }
    state = { rpmCount: 0, lastReset: now, concurrency: 0 };
    userLimits.set(userId, state);
  }

  if (now - state.lastReset > RPM_WINDOW) {
    state.rpmCount = 0;
    state.lastReset = now;
  }

  if (state.rpmCount >= MAX_RPM) {
    logger.warn({ userId, rpm: state.rpmCount }, "User exceeded RPM limit");
    res.status(429).json({ 
      error: "Too many requests. Please wait a minute.",
      retryAfter: Math.ceil((RPM_WINDOW - (now - state.lastReset)) / 1000)
    });
    return;
  }

  if (state.concurrency >= MAX_CONCURRENCY) {
    logger.warn({ userId, concurrency: state.concurrency }, "User exceeded concurrency limit");
    res.status(429).json({ error: "Too many simultaneous requests. Please wait for previous tasks to complete." });
    return;
  }

  state.rpmCount++;
  state.concurrency++;

  const decrement = () => {
    const s = userLimits.get(userId);
    if (s && s.concurrency > 0) {
      s.concurrency--;
    }
    if (s && s.concurrency === 0 && (Date.now() - s.lastReset > RPM_WINDOW)) {
    }
  };

  res.on("finish", decrement);
  res.on("close", decrement);

  next();
}
