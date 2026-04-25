// Unified Redis client using ioredis (consolidates former dual-client setup).
// Previously this used `redis` (node-redis) while queue/rateLimit used `ioredis`.
// Now all Redis access goes through ioredis for a single connection pool.
//
// Redis Memory Cap Guidance
// ─────────────────────────────────
// Without a maxmemory policy, Redis will grow unbounded and OOM the host.
// Recommended redis.conf settings for production:
//   maxmemory 512mb
//   maxmemory-policy allkeys-lru
//
// Key TTL guidelines:
//   - Semantic cache entries: 24h TTL (set in cache.ts)
//   - Rate limit keys: 60s TTL
//   - Session keys: 7d TTL
//   - Artifact streams: should be cleaned up after completion
//
// Monitor with: redis-cli INFO memory | grep used_memory_human
import { Redis } from "ioredis";
import { env } from "../config/env.js";
import logger from "./logger.js";

let client: Redis | null = null;
let connecting = false;

function validateKey(key: string): void {
  if (key.length > 1024) throw new Error("Redis key exceeds maximum length of 1024 bytes");
  if (/[\r\n]/.test(key)) throw new Error("Redis key contains invalid characters");
}

function getRedis(): Redis {
  if (client && client.status === "ready") return client;

  if (!client) {
    client = new Redis(env.REDIS_URL || "redis://localhost:6379", {
      maxRetriesPerRequest: null,
      connectTimeout: 5000,
      retryStrategy: (times: number) => {
        if (times > 10) {
          logger.error("Redis max reconnection attempts reached — operating in degraded mode");
          return null;
        }
        return Math.min(times * 100, 3000);
      },
      lazyConnect: true,
    });

    client.on("error", (err: Error) => {
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

    if (!connecting) {
      connecting = true;
      client.connect().catch((err: Error) => {
        logger.warn({ err: err.message }, "Redis initialization failed");
        connecting = false;
      });
    }
  }

  return client;
}

const redisWrapper = {
  async get(key: string): Promise<string | null> {
    validateKey(key);
    try {
      return await getRedis().get(key);
    } catch {
      return null;
    }
  },

  async set(key: string, value: string, options?: { EX?: number; PX?: number }): Promise<string | null> {
    validateKey(key);
    try {
      const c = getRedis();
      if (options?.PX) {
        return await c.set(key, value, "PX", options.PX);
      }
      if (options?.EX) {
        return await c.set(key, value, "EX", options.EX);
      }
      return await c.set(key, value);
    } catch {
      return null;
    }
  },

  async del(key: string): Promise<number> {
    validateKey(key);
    try {
      return await getRedis().del(key);
    } catch {
      return 0;
    }
  },

  async ping(): Promise<string> {
    try {
      return await getRedis().ping();
    } catch {
      return "PONG (fallback)";
    }
  },

  async quit(): Promise<void> {
    try {
      if (client) {
        await client.quit();
        client = null;
        connecting = false;
      }
    } catch { /* ignore */ }
  },

  // Use SCAN cursor to avoid blocking Redis event loop
  // Cap iteration count to prevent unbounded key accumulation
  async keys(pattern: string): Promise<string[]> {
    try {
      const c = getRedis();
      const results: string[] = [];
      let cursor = "0";
      let iterations = 0;
      const MAX_ITERATIONS = 1000;
      const MAX_KEYS = 100_000;
      do {
        const [nextCursor, keys] = await c.scan(cursor, "MATCH", pattern, "COUNT", 100);
        cursor = nextCursor;
        results.push(...keys);
        iterations++;
        if (iterations >= MAX_ITERATIONS || results.length >= MAX_KEYS) break;
      } while (cursor !== "0");
      return results;
    } catch {
      return [];
    }
  },

  async pttl(key: string): Promise<number> {
    validateKey(key);
    try {
      return await getRedis().pttl(key);
    } catch {
      return -2;
    }
  },

  async ttl(key: string): Promise<number> {
    try {
      const ms = await getRedis().pttl(key);
      if (ms < 0) return ms;
      return Math.ceil(ms / 1000);
    } catch {
      return -2;
    }
  },

  // flushAll requires explicit DANGER flag
  async flushAll(options?: { DANGER_CONFIRM: true }): Promise<string> {
    if (!options?.DANGER_CONFIRM) {
      logger.error("flushAll() called without DANGER_CONFIRM flag — refusing to execute");
      throw new Error("flushAll() requires { DANGER_CONFIRM: true } to prevent accidental data loss");
    }
    try {
      logger.warn("Executing Redis FLUSHALL — all data will be deleted");
      return await getRedis().flushall();
    } catch {
      return "OK";
    }
  },

  async incr(key: string): Promise<number> {
    validateKey(key);
    try {
      return await getRedis().incr(key);
    } catch {
      return 0;
    }
  },

  async decr(key: string): Promise<number> {
    validateKey(key);
    try {
      return await getRedis().decr(key);
    } catch {
      return 0;
    }
  },

  async expire(key: string, seconds: number): Promise<boolean> {
    validateKey(key);
    try {
      const result = await getRedis().expire(key, seconds);
      return result === 1;
    } catch {
      return false;
    }
  },

  // Redis Streams support for multi-replica pub/sub
  async xadd(key: string, id: string, ...fieldValues: string[]): Promise<string | null> {
    validateKey(key);
    try {
      return await getRedis().xadd(key, id, ...fieldValues);
    } catch {
      return null;
    }
  },

  async xread(streams: string[], ids: string[], count?: number): Promise<unknown[] | null> {
    try {
      const args: (string | number)[] = [];
      if (count) args.push("COUNT", count);
      args.push("STREAMS", ...streams, ...ids);
      return await (getRedis() as unknown as { xread: (...args: (string | number)[]) => Promise<unknown[] | null> }).xread(...args);
    } catch {
      return null;
    }
  },

  pipeline() {
    const p = getRedis().pipeline();
    return {
      get(key: string) {
        p.get(key);
        return this;
      },
      set(key: string, value: string) {
        p.set(key, value);
        return this;
      },
      del(key: string) {
        p.del(key);
        return this;
      },
      incr(key: string) {
        p.incr(key);
        return this;
      },
      incrby(key: string, increment: number) {
        p.incrby(key, increment);
        return this;
      },
      expire(key: string, seconds: number) {
        p.expire(key, seconds);
        return this;
      },
      async exec(): Promise<Array<[Error | null, unknown]>> {
        try {
          const results = await p.exec();
          if (!results) return [];
          for (const [err] of results) {
            if (err) {
              logger.warn({ err: (err as Error).message }, "Redis pipeline command error");
            }
          }
          return results as Array<[Error | null, unknown]>;
        } catch {
          return [];
        }
      },
    };
  },
};

export default redisWrapper;
