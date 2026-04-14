import { env } from "../config/env.js";
import logger from "../lib/logger.js";
import IORedisDefault from "ioredis";
const IORedis = IORedisDefault.default || IORedisDefault;

// Redis client used for rate limit state — needs cleanup on shutdown
let rateLimitRedisClient: any;
try {
  rateLimitRedisClient = new (IORedis as any)(env.REDIS_URL || "redis://localhost:6379", {
    maxRetriesPerRequest: null,
    enableOfflineQueue: false,
    lazyConnect: true,
  });
  rateLimitRedisClient.connect().catch(() => {});
} catch {
  logger.warn("Redis store for rate limiter unavailable");
}

export async function cleanupRateLimitRedis(): Promise<void> {
  if (rateLimitRedisClient) {
    try {
      await rateLimitRedisClient.quit();
    } catch { /* ignore */ }
  }
}
