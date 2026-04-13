import { createClient, RedisClientType } from "redis";
import { env } from "../config/env.js";
import logger from "./logger.js";

let redis: RedisClientType;

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

let redisPromise: Promise<RedisClientType> | null = null;

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
    } catch { /* ignore */ }
  },

  async keys(pattern: string): Promise<string[]> {
    try {
      const client = await getRedis();
      return await client.keys(pattern);
    } catch {
      return [];
    }
  },

  /** Returns the remaining TTL in milliseconds (uses Redis PTTL command). */
  async pttl(key: string): Promise<number> {
    try {
      const client = await getRedis();
      return await client.pTTL(key);
    } catch {
      return -2;
    }
  },

  /** Returns the remaining TTL in seconds (converts from Redis PTTL milliseconds). */
  async ttl(key: string): Promise<number> {
    try {
      const client = await getRedis();
      const ms = await client.pTTL(key);
      // Negative values (-1 = no expiry, -2 = key missing) pass through as-is
      if (ms < 0) return ms;
      return Math.ceil(ms / 1000);
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

  async incr(key: string): Promise<number> {
    try {
      const client = await getRedis();
      return await client.incr(key);
    } catch {
      return 0;
    }
  },

  async decr(key: string): Promise<number> {
    try {
      const client = await getRedis();
      return await client.decr(key);
    } catch {
      return 0;
    }
  },

  async expire(key: string, seconds: number): Promise<boolean> {
    try {
      const client = await getRedis();
      return await client.expire(key, seconds);
    } catch {
      return false;
    }
  },
};

export default redisWrapper;