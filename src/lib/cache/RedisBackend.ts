import redis from "../redis.js";
import logger from "../logger.js";
import type { CacheBackend, CacheEntry } from "./CacheBackend.js";

// P9-29: Maximum payload size for Redis cache entries (1MB)
const MAX_PAYLOAD_BYTES = 1_000_000;

export class RedisBackend implements CacheBackend {
  private keyPrefix: string;

  constructor(keyPrefix = "cache:") {
    this.keyPrefix = keyPrefix;
  }

  private getKey(key: string): string {
    return `${this.keyPrefix}${key}`;
  }

  async get(key: string): Promise<CacheEntry | null> {
    const value = await redis.get(this.getKey(key));
    if (!value) return null;

    try {
      return JSON.parse(value) as CacheEntry;
    } catch (err) {
      // P21-06: Log JSON parse errors for debugging corrupted cache entries
      logger.warn({ key: this.getKey(key), err: (err as Error).message }, "Redis cache entry JSON parse failed — returning null");
      return null;
    }
  }

  async set(key: string, value: CacheEntry, ttlMs: number): Promise<void> {
    // P9-28: Validate TTL — 0 or negative should not create entries with no expiry
    if (!ttlMs || ttlMs <= 0) {
      logger.warn({ key, ttlMs }, "Redis cache set called with invalid TTL — using default 24h");
      ttlMs = 24 * 60 * 60 * 1000;
    }

    const serialized = JSON.stringify(value);

    // P9-29: Guard against oversized payloads that could exhaust Redis memory
    if (serialized.length > MAX_PAYLOAD_BYTES) {
      logger.warn({ key, size: serialized.length, maxSize: MAX_PAYLOAD_BYTES }, "Cache entry too large for Redis — skipping");
      return;
    }

    await redis.set(this.getKey(key), serialized, { PX: ttlMs });
  }

  async delete(key: string): Promise<void> {
    await redis.del(this.getKey(key));
  }

  // P9-30: Semantic cache methods are not applicable to Redis backend.
  // Explicitly NOT implemented — vector search requires PostgreSQL.
  // The CacheBackend interface marks these as optional (?), so this is correct.
}

export const redisBackend = new RedisBackend();
