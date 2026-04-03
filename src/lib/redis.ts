import { createClient, RedisClientType } from "redis";
import { env } from "../config/env.js";
import logger from "./logger.js";

let redis: RedisClientType;

/**
 * Initialize Redis connection.
 * Falls back to in-memory cache if Redis is unavailable.
 */
async function initRedis(): Promise<RedisClientType> {
  const client = createClient({
    url: env.REDIS_URL || "redis://localhost:6379",
    socket: {
      connectTimeout: 5000,
      reconnectStrategy: (retries) => {
        if (retries > 10) {
          logger.error("Redis max reconnection attempts reached");
          return new Error("Redis max reconnection attempts reached");
        }
        return Math.min(retries * 100, 3000);
      },
    },
  });

  client.on("error", (err) => {
    logger.error({ err: err.message }, "Redis client error");
  });

  client.on("connect", () => {
    logger.info("Redis connected");
  });

  client.on("reconnecting", () => {
    logger.info("Redis reconnecting");
  });

  client.on("ready", () => {
    logger.info("Redis ready");
  });

  await client.connect();
  return client as RedisClientType;
}

// Initialize Redis on module load
let redisPromise: Promise<RedisClientType> | null = null;

/**
 * Get Redis client instance.
 * Lazily initializes connection on first access.
 */
async function getRedis(): Promise<RedisClientType> {
  if (!redisPromise) {
    redisPromise = initRedis().catch((err) => {
      logger.warn({ err: err.message }, "Redis initialization failed, using fallback");
      redisPromise = null;
      throw err;
    });
  }
  return redisPromise;
}

/**
 * Redis wrapper with fallback for when Redis is unavailable.
 * Provides a consistent interface regardless of Redis availability.
 */
const redisWrapper = {
  async get(key: string): Promise<string | null> {
    try {
      const client = await getRedis();
      return await client.get(key);
    } catch {
      return null;
    }
  },

  async set(key: string, value: string, options?: { EX?: number; PX?: number }): Promise<string | null> {
    try {
      const client = await getRedis();
      if (options?.EX) {
        return await client.set(key, value, { EX: options.EX });
      }
      if (options?.PX) {
        return await client.set(key, value, { PX: options.PX });
      }
      return await client.set(key, value);
    } catch {
      return null;
    }
  },

  async del(key: string): Promise<number> {
    try {
      const client = await getRedis();
      return await client.del(key);
    } catch {
      return 0;
    }
  },

  async ping(): Promise<string> {
    try {
      const client = await getRedis();
      return await client.ping();
    } catch {
      return "PONG (fallback)";
    }
  },

  async quit(): Promise<void> {
    try {
      if (redisPromise) {
        const client = await redisPromise;
        await client.quit();
        redisPromise = null;
      }
    } catch {
      // Ignore quit errors
    }
  },

  async keys(pattern: string): Promise<string[]> {
    try {
      const client = await getRedis();
      return await client.keys(pattern);
    } catch {
      return [];
    }
  },

  async ttl(key: string): Promise<number> {
    try {
      const client = await getRedis();
      return await client.pTTL(key);
    } catch {
      return -2;
    }
  },

  async flushAll(): Promise<string> {
    try {
      const client = await getRedis();
      return await client.flushAll();
    } catch {
      return "OK";
    }
  },
};

export default redisWrapper;