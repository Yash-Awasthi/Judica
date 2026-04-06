import redis from "../redis.js";
import type { CacheBackend, CacheEntry } from "./CacheBackend.js";

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
    } catch {
      return null;
    }
  }

  async set(key: string, value: CacheEntry, ttlMs?: number): Promise<void> {
    const serialized = JSON.stringify(value);
    if (ttlMs) {
      await redis.set(this.getKey(key), serialized, { PX: ttlMs });
    } else {
      await redis.set(this.getKey(key), serialized);
    }
  }

  async delete(key: string): Promise<void> {
    await redis.del(this.getKey(key));
  }
}

export const redisBackend = new RedisBackend();
