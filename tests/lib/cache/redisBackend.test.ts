import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../src/lib/redis.js", () => ({
  default: {
    get: vi.fn(),
    set: vi.fn(),
    setex: vi.fn(),
    del: vi.fn(),
  },
}));

import { RedisBackend } from "../../../src/lib/cache/RedisBackend.js";
import redis from "../../../src/lib/redis.js";

const mockRedis = redis as any;

describe("RedisBackend", () => {
  let backend: RedisBackend;

  beforeEach(() => {
    vi.clearAllMocks();
    backend = new RedisBackend();
  });

  describe("get", () => {
    it("returns parsed JSON for a cache hit", async () => {
      const cached = { data: "hello", value: 42 };
      mockRedis.get.mockResolvedValue(JSON.stringify(cached));

      const result = await backend.get("my-key");

      expect(mockRedis.get).toHaveBeenCalledWith("cache:my-key");
      expect(result).toEqual(cached);
    });

    it("returns null for a cache miss", async () => {
      mockRedis.get.mockResolvedValue(null);

      const result = await backend.get("missing-key");

      expect(mockRedis.get).toHaveBeenCalledWith("cache:missing-key");
      expect(result).toBeNull();
    });

    it("returns null when stored value is not valid JSON", async () => {
      mockRedis.get.mockResolvedValue("not-valid-json{{{");

      const result = await backend.get("bad-json");

      expect(result).toBeNull();
    });
  });

  describe("set", () => {
    it("sets value with TTL in milliseconds using PX option", async () => {
      const value = { data: "test" };
      mockRedis.set.mockResolvedValue("OK");

      await backend.set("ttl-key", value as any, 5000);

      expect(mockRedis.set).toHaveBeenCalledWith(
        "cache:ttl-key",
        JSON.stringify(value),
        { PX: 5000 }
      );
    });

    it("sets value with default 24h TTL when no TTL provided", async () => {
      const value = { data: "persistent" };
      mockRedis.set.mockResolvedValue("OK");

      await backend.set("no-ttl-key", value as any);

      expect(mockRedis.set).toHaveBeenCalledWith(
        "cache:no-ttl-key",
        JSON.stringify(value),
        { PX: 86400000 }
      );
    });
  });

  describe("delete", () => {
    it("deletes a key with the correct prefix", async () => {
      mockRedis.del.mockResolvedValue(1);

      await backend.delete("del-key");

      expect(mockRedis.del).toHaveBeenCalledWith("cache:del-key");
    });
  });

  describe("custom prefix", () => {
    it("uses a custom key prefix", async () => {
      const custom = new RedisBackend("myapp:");
      mockRedis.get.mockResolvedValue(JSON.stringify({ ok: true }));

      await custom.get("test");

      expect(mockRedis.get).toHaveBeenCalledWith("myapp:test");
    });
  });
});
