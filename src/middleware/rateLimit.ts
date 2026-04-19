import { env } from "../config/env.js";
import logger from "../lib/logger.js";
import IORedisDefault from "ioredis";
const IORedis = IORedisDefault.default || IORedisDefault;

// Redis client used for rate limit state — needs cleanup on shutdown
let rateLimitRedisClient: InstanceType<typeof IORedis> | undefined;
try {
  rateLimitRedisClient = new (IORedis as typeof IORedis)(env.REDIS_URL || "redis://localhost:6379", {
    maxRetriesPerRequest: null,
    enableOfflineQueue: false,
    lazyConnect: true,
  });
  rateLimitRedisClient.connect().catch(() => {
    logger.warn("Rate limit Redis connection failed — falling back to in-memory store");
  });
} catch {
  logger.warn("Redis store for rate limiter unavailable");
}

/** The ioredis client for @fastify/rate-limit Redis store. May be undefined if Redis is unavailable. */
export function getRateLimitRedis(): InstanceType<typeof IORedis> | undefined {
  return rateLimitRedisClient;
}

export async function cleanupRateLimitRedis(): Promise<void> {
  if (rateLimitRedisClient) {
    try {
      await rateLimitRedisClient.quit();
    } catch { /* ignore */ }
  }
}
