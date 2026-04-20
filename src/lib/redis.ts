// P2-24: This uses the `redis` (node-redis) package for application data.
// @fastify/rate-limit requires `ioredis` — see middleware/rateLimit.ts.
// Two Redis clients are intentional: rate-limit needs ioredis API compatibility.
// Future: consider migrating app data to ioredis to unify into one client.
//
// P9-40: TODO — Single Redis client shared for all operations (rate limiting, cache, pub/sub).
// Under high throughput, consider connection pooling or separate clients per concern:
//   - Rate limiting: low-latency, high-frequency INCR/EXPIRE
//   - Cache: larger payloads, less frequent
//   - Pub/sub: long-lived subscriptions (MUST be a separate connection)
//
// P4-11: Redis Memory Cap Guidance
// ─────────────────────────────────
// Without a maxmemory policy, Redis will grow unbounded and OOM the host.
// This is especially dangerous with long-running artifact streams and semantic cache.
//
// Recommended redis.conf settings for production:
//   maxmemory 512mb                    # Adjust based on available RAM
//   maxmemory-policy allkeys-lru       # Evict least-recently-used keys under pressure
//
// For Docker/Kubernetes deployments:
//   docker run redis --maxmemory 512mb --maxmemory-policy allkeys-lru
//
// Key TTL guidelines:
//   - Semantic cache entries: 24h TTL (set in cache.ts)
//   - Rate limit keys: 60s TTL
//   - Session keys: 7d TTL
//   - Artifact streams: should be cleaned up after completion
//
// Monitor with: redis-cli INFO memory | grep used_memory_human
import { createClient, RedisClientType } from "redis";
import { env } from "../config/env.js";
import logger from "./logger.js";

async function initRedis(): Promise<RedisClientType> {
  const client = createClient({
    url: env.REDIS_URL || "redis://localhost:6379",
    socket: {
      connectTimeout: 5000,
      reconnectStrategy: (retries) => {
        if (retries > 10) {
          // P9-37: Log and allow process to continue (don't throw) —
          // returning false stops reconnection; wrapper methods handle unavailability gracefully.
          logger.error("Redis max reconnection attempts reached — operating in degraded mode");
          return false as unknown as number;
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

  // P9-38: Document precedence — PX takes priority over EX when both are provided
  async set(key: string, value: string, options?: { EX?: number; PX?: number }): Promise<string | null> {
    try {
      const client = await getRedis();
      // P9-38: PX (milliseconds) takes precedence over EX (seconds) if both given
      if (options?.PX) {
        return await client.set(key, value, { PX: options.PX });
      }
      if (options?.EX) {
        return await client.set(key, value, { EX: options.EX });
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

  // P9-39: Replace O(n) KEYS with SCAN cursor to avoid blocking Redis event loop
  async keys(pattern: string): Promise<string[]> {
    try {
      const client = await getRedis();
      const results: string[] = [];
      for await (const key of client.scanIterator({ MATCH: pattern, COUNT: 100 })) {
        results.push(key);
      }
      return results;
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

  // P9-36: flushAll requires explicit DANGER flag — prevents accidental production wipe
  async flushAll(options?: { DANGER_CONFIRM: true }): Promise<string> {
    if (!options?.DANGER_CONFIRM) {
      logger.error("flushAll() called without DANGER_CONFIRM flag — refusing to execute");
      throw new Error("flushAll() requires { DANGER_CONFIRM: true } to prevent accidental data loss");
    }
    try {
      const client = await getRedis();
      logger.warn("Executing Redis FLUSHALL — all data will be deleted");
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
      const result = await client.expire(key, seconds);
      return Boolean(result);
    } catch {
      return false;
    }
  },

  /**
   * Returns a pipeline-like object that batches multiple commands into a
   * single Redis round-trip.  Uses the node-redis `multi()` under the hood
   * (MULTI/EXEC), but the caller treats it like ioredis `.pipeline()`:
   *
   *   const p = redis.pipeline();
   *   p.get("key1");
   *   p.get("key2");
   *   const results = await p.exec();
   *   // results = [[null, value1], [null, value2]]
   */
  pipeline() {
    let clientMulti: ReturnType<RedisClientType["multi"]> | null = null;
    const initPromise = getRedis().then((c) => {
      clientMulti = c.multi();
    }).catch(() => { /* Redis unavailable — exec() will return empty */ });

    return {
      get(key: string) {
        void initPromise.then(() => clientMulti?.get(key));
        return this;
      },
      set(key: string, value: string) {
        void initPromise.then(() => clientMulti?.set(key, value));
        return this;
      },
      del(key: string) {
        void initPromise.then(() => clientMulti?.del(key));
        return this;
      },
      async exec(): Promise<Array<[null, unknown]>> {
        try {
          await initPromise;
          if (!clientMulti) return [];
          const results = await clientMulti.exec();
          // node-redis multi().exec() returns values directly; wrap in ioredis format [err, value]
          return (results ?? []).map((val: unknown) => [null, val] as [null, unknown]);
        } catch {
          return [];
        }
      },
    };
  },
};

export default redisWrapper;
