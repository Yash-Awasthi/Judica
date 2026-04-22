import { env } from "../config/env.js";
import logger from "../lib/logger.js";
import IORedisDefault from "ioredis";
const IORedis = IORedisDefault.default || IORedisDefault;

// P1-19: Redis client for @fastify/rate-limit — properly tracks connection state
let rateLimitRedisClient: InstanceType<typeof IORedis> | undefined;
let redisReady = false;

try {
  rateLimitRedisClient = new (IORedis as typeof IORedis)(env.REDIS_URL || "redis://localhost:6379", {
    maxRetriesPerRequest: null,
    enableOfflineQueue: false,
    lazyConnect: true,
  });

  rateLimitRedisClient.on("ready", () => { redisReady = true; });
  rateLimitRedisClient.on("error", (err) => { redisReady = false; logger.warn({ err: err.message }, "Rate limit Redis error"); });
  rateLimitRedisClient.on("close", () => { redisReady = false; });

  rateLimitRedisClient.connect().catch(() => {
    logger.warn("Rate limit Redis connection failed — falling back to in-memory store");
    rateLimitRedisClient = undefined;
  });
} catch {
  logger.warn("Redis store for rate limiter unavailable");
  rateLimitRedisClient = undefined;
}

/** The ioredis client for @fastify/rate-limit Redis store. Returns undefined if Redis is unavailable. */
export function getRateLimitRedis(): InstanceType<typeof IORedis> | undefined {
  // P1-19: Only return client if it's actually connected and ready
  return redisReady ? rateLimitRedisClient : undefined;
}

/** P1-20: Check if rate-limit Redis is healthy */
export function isRateLimitRedisHealthy(): boolean {
  return redisReady && rateLimitRedisClient !== undefined;
}

export async function cleanupRateLimitRedis(): Promise<void> {
  if (rateLimitRedisClient) {
    try {
      // P58-01: Timeout quit to prevent blocking shutdown if Redis is hung
      await Promise.race([
        rateLimitRedisClient.quit(),
        new Promise(resolve => setTimeout(resolve, 3000)),
      ]);
    } catch { /* ignore */ }
  }
}
