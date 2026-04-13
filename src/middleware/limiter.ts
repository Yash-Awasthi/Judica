import { Response, NextFunction } from "express";
import { AuthRequest } from "../types/index.js";
import redis from "../lib/redis.js";
import logger from "../lib/logger.js";

/**
 * Redis-backed distributed rate limiting using INCR + EXPIRE pattern.
 * Falls back to in-memory Map if Redis is unavailable.
 *
 * Redis keys:
 *   rl:rpm:{userId}  — RPM counter with TTL = RPM_WINDOW seconds
 *   rl:conc:{userId} — Concurrency counter (no TTL, managed via incr/decr)
 */

// ---------- In-memory fallback ----------
interface UserLimitState {
  rpmCount: number;
  lastReset: number;
  concurrency: number;
}

const fallbackLimits = new Map<number, UserLimitState>();
const MAX_MAP_SIZE = 100_000;

// Periodic cleanup for fallback map
const CLEANUP_INTERVAL = 5 * 60 * 1000;
setInterval(() => {
  const now = Date.now();
  for (const [userId, state] of fallbackLimits) {
    if (now - state.lastReset > RPM_WINDOW && state.concurrency === 0) {
      fallbackLimits.delete(userId);
    }
  }
}, CLEANUP_INTERVAL).unref();

// ---------- Constants ----------
const MAX_RPM = 1000; // 1000 requests per minute per user
const MAX_CONCURRENCY = 100; // 100 simultaneous requests per user
const RPM_WINDOW = 60000; // 1 minute window
const RPM_WINDOW_SECS = Math.ceil(RPM_WINDOW / 1000);

// ---------- Redis availability probe ----------
let redisAvailable = true;
let lastRedisCheck = 0;
const REDIS_CHECK_INTERVAL = 10_000; // re-check every 10s after failure

async function isRedisUp(): Promise<boolean> {
  if (redisAvailable) return true;
  const now = Date.now();
  if (now - lastRedisCheck < REDIS_CHECK_INTERVAL) return false;
  lastRedisCheck = now;
  try {
    const pong = await redis.ping();
    if (pong) {
      redisAvailable = true;
      logger.info("Rate limiter: Redis recovered, switching back from in-memory fallback");
      return true;
    }
  } catch { /* still down */ }
  return false;
}

// ---------- Redis-backed limiter ----------
async function redisLimiter(userId: number, res: Response, next: NextFunction): Promise<void> {
  const rpmKey = `rl:rpm:${userId}`;
  const concKey = `rl:conc:${userId}`;

  try {
    // Increment RPM counter; set TTL on first increment
    const rpmRaw = await redis.incr(rpmKey);
    const rpmCount = rpmRaw ?? 0;

    // Set expiry only when counter was just created (value == 1)
    if (rpmCount === 1) {
      await redis.expire(rpmKey, RPM_WINDOW_SECS);
    }

    if (rpmCount > MAX_RPM) {
      const ttl = await redis.ttl(rpmKey); // returns seconds
      const retryAfter = ttl > 0 ? ttl : RPM_WINDOW_SECS;
      logger.warn({ userId, rpm: rpmCount }, "User exceeded RPM limit");
      res.status(429).json({
        error: "Too many requests. Please wait a minute.",
        retryAfter,
      });
      return;
    }

    // Increment concurrency
    const concRaw = await redis.incr(concKey);
    const concurrency = concRaw ?? 0;

    if (concurrency > MAX_CONCURRENCY) {
      // Roll back concurrency since we won't process this request
      await redis.decr(concKey);
      logger.warn({ userId, concurrency }, "User exceeded concurrency limit");
      res.status(429).json({ error: "Too many simultaneous requests. Please wait for previous tasks to complete." });
      return;
    }

    // Decrement concurrency when response finishes
    let decremented = false;
    const decrement = async () => {
      if (decremented) return;
      decremented = true;
      try {
        await redis.decr(concKey);
      } catch { /* best effort */ }
    };

    res.on("finish", decrement);
    res.on("close", decrement);

    next();
  } catch (err) {
    // Redis failed mid-request — mark unavailable and fall through to in-memory
    redisAvailable = false;
    lastRedisCheck = Date.now();
    logger.warn({ err }, "Rate limiter: Redis call failed, falling back to in-memory");
    inMemoryLimiter(userId, res, next);
  }
}

// ---------- In-memory fallback limiter ----------
function inMemoryLimiter(userId: number, res: Response, next: NextFunction): void {
  let state = fallbackLimits.get(userId);
  const now = Date.now();

  if (!state) {
    if (fallbackLimits.size >= MAX_MAP_SIZE) {
      logger.warn("Per-user rate limit map reached max size; rejecting new user");
      res.status(429).json({ error: "Server is busy. Please try again later." });
      return;
    }
    state = { rpmCount: 0, lastReset: now, concurrency: 0 };
    fallbackLimits.set(userId, state);
  }

  if (now - state.lastReset > RPM_WINDOW) {
    state.rpmCount = 0;
    state.lastReset = now;
  }

  if (state.rpmCount >= MAX_RPM) {
    logger.warn({ userId, rpm: state.rpmCount }, "User exceeded RPM limit");
    res.status(429).json({
      error: "Too many requests. Please wait a minute.",
      retryAfter: Math.ceil((RPM_WINDOW - (now - state.lastReset)) / 1000),
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
    const s = fallbackLimits.get(userId);
    if (s && s.concurrency > 0) {
      s.concurrency--;
    }
  };

  res.on("finish", decrement);
  res.on("close", decrement);

  next();
}

// ---------- Exported middleware ----------
export async function perUserLimiter(req: AuthRequest, res: Response, next: NextFunction) {
  const userId = req.userId;
  if (!userId) return next();

  if (await isRedisUp()) {
    return redisLimiter(userId, res, next);
  }

  inMemoryLimiter(userId, res, next);
}
