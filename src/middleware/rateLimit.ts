import rateLimit from "express-rate-limit";
import { Request, Response, NextFunction } from "express";
import { env } from "../config/env.js";
import logger from "../lib/logger.js";
import { RedisStore } from "rate-limit-redis";
import IORedisDefault from "ioredis";
const IORedis = IORedisDefault.default || IORedisDefault;

const commonHandler = (req: Request, res: Response, _next: NextFunction, options: any) => {
  logger.warn({
    path: req.path,
    ip: req.ip,
  }, "Rate limit exceeded");
  res.status(options.statusCode).send(options.message);
};

// Redis-backed store for clustered/multi-instance deployments
let redisStore: RedisStore | undefined;
try {
  const redisClient = new (IORedis as any)(env.REDIS_URL || "redis://localhost:6379", {
    maxRetriesPerRequest: null,
    enableOfflineQueue: false,
    lazyConnect: true,
  });
  redisClient.connect().catch(() => {});

  redisStore = new RedisStore({
    sendCommand: (...args: string[]) => redisClient.call(...args) as any,
    prefix: "rl:",
  });
} catch {
  logger.warn("Redis store for rate limiter unavailable, falling back to memory store");
}

const userKeyGenerator = (req: any) => {
  if (req.userId) {
    const ip = req.ip || "127.0.0.1";
    return `user:${req.userId}:${ip}`;
  }
  return req.ip || "127.0.0.1";
};

export const askLimiter = rateLimit({
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  max: 60,
  keyGenerator: userKeyGenerator,
  message: { error: "Too many requests, slow down." },
  standardHeaders: true,
  legacyHeaders: false,
  handler: commonHandler,
  validate: { keyGeneratorIpFallback: false },
  ...(redisStore ? { store: redisStore } : {}),
});

// SEC-5: Auth limiter set to 10/min to prevent brute-force credential stuffing.
// This is deliberately low because legitimate users rarely need more than a few
// auth attempts per minute. Failed attempts still count toward the limit.
export const authLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 10,
  keyGenerator: userKeyGenerator,
  message: { error: "Too many auth attempts, try again later." },
  standardHeaders: true,
  legacyHeaders: false,
  handler: commonHandler,
  validate: { keyGeneratorIpFallback: false },
  ...(redisStore ? { store: redisStore } : {}),
});

export const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  keyGenerator: userKeyGenerator,
  message: { error: "API rate limit exceeded (60 req/min)." },
  standardHeaders: true,
  legacyHeaders: false,
  handler: commonHandler,
  validate: { keyGeneratorIpFallback: false },
  ...(redisStore ? { store: redisStore } : {}),
});

export const sandboxLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  keyGenerator: userKeyGenerator,
  message: { error: "Sandbox rate limit exceeded (10 req/min)." },
  standardHeaders: true,
  legacyHeaders: false,
  handler: commonHandler,
  validate: { keyGeneratorIpFallback: false },
  ...(redisStore ? { store: redisStore } : {}),
});

export const voiceLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  keyGenerator: userKeyGenerator,
  message: { error: "Voice rate limit exceeded (20 req/min)." },
  standardHeaders: true,
  legacyHeaders: false,
  handler: commonHandler,
  validate: { keyGeneratorIpFallback: false },
  ...(redisStore ? { store: redisStore } : {}),
});
