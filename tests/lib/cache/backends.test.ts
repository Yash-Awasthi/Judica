import { describe, it, expect, vi, beforeEach } from "vitest";

// Use vi.hoisted so these are available inside vi.mock factories
const {
  mockRedisGet, mockRedisSet, mockRedisDel,
  mockDbFrom, mockDbWhere, mockDbLimit,
  mockDbValues, mockDbOnConflict, mockDbDeleteWhere,
} = vi.hoisted(() => ({
  mockRedisGet: vi.fn(),
  mockRedisSet: vi.fn(),
  mockRedisDel: vi.fn(),
  mockDbFrom: vi.fn(),
  mockDbWhere: vi.fn(),
  mockDbLimit: vi.fn(),
  mockDbValues: vi.fn(),
  mockDbOnConflict: vi.fn(),
  mockDbDeleteWhere: vi.fn(),
}));

vi.mock("../../../src/lib/redis.js", () => ({
  default: {
    get: mockRedisGet,
    set: mockRedisSet,
    del: mockRedisDel,
  },
}));

vi.mock("../../../src/lib/drizzle.js", () => ({
  db: {
    select: () => ({ from: mockDbFrom }),
    insert: () => ({ values: mockDbValues }),
    delete: () => ({ where: mockDbDeleteWhere }),
  },
}));

vi.mock("../../../src/db/schema/conversations.js", () => ({
  semanticCache: {
    keyHash: "keyHash",
    prompt: "prompt",
    verdict: "verdict",
    opinions: "opinions",
    expiresAt: "expiresAt",
    createdAt: "createdAt",
    embedding: "embedding",
  },
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((a: any, b: any) => ({ field: a, value: b })),
  sql: vi.fn((...args: any[]) => ({ sql: true })),
  and: vi.fn((...args: any[]) => args),
  gte: vi.fn((a: any, b: any) => ({ field: a, value: b })),
}));

vi.mock("../../../src/lib/logger.js", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { RedisBackend } from "../../../src/lib/cache/RedisBackend.js";
import { PostgresBackend } from "../../../src/lib/cache/PostgresBackend.js";

describe("RedisBackend", () => {
  let backend: RedisBackend;

  beforeEach(() => {
    vi.clearAllMocks();
    backend = new RedisBackend("test:");
  });

  it("get returns parsed cache entry", async () => {
    const entry = { verdict: "approved", opinions: [{ text: "good" }] };
    mockRedisGet.mockResolvedValue(JSON.stringify(entry));

    const result = await backend.get("key1");
    expect(result).toEqual(entry);
    expect(mockRedisGet).toHaveBeenCalledWith("test:key1");
  });

  it("get returns null when key not found", async () => {
    mockRedisGet.mockResolvedValue(null);

    const result = await backend.get("missing");
    expect(result).toBeNull();
  });

  it("get returns null on invalid JSON", async () => {
    mockRedisGet.mockResolvedValue("not-json{{{");

    const result = await backend.get("bad");
    expect(result).toBeNull();
  });

  it("set stores serialized entry without TTL", async () => {
    const entry = { verdict: "ok", opinions: [] };
    await backend.set("key1", entry);

    expect(mockRedisSet).toHaveBeenCalledWith("test:key1", JSON.stringify(entry));
  });

  it("set stores serialized entry with TTL", async () => {
    const entry = { verdict: "ok", opinions: [] };
    await backend.set("key1", entry, 60000);

    expect(mockRedisSet).toHaveBeenCalledWith("test:key1", JSON.stringify(entry), { PX: 60000 });
  });

  it("delete removes key from redis", async () => {
    await backend.delete("key1");
    expect(mockRedisDel).toHaveBeenCalledWith("test:key1");
  });

  it("uses default prefix when none provided", () => {
    const defaultBackend = new RedisBackend();
    mockRedisGet.mockResolvedValue(null);
    defaultBackend.get("test");
    expect(mockRedisGet).toHaveBeenCalledWith("cache:test");
  });
});

describe("PostgresBackend", () => {
  let backend: PostgresBackend;

  beforeEach(() => {
    vi.clearAllMocks();
    backend = new PostgresBackend();
    mockDbFrom.mockReturnValue({ where: mockDbWhere });
    mockDbWhere.mockReturnValue({ limit: mockDbLimit });
    mockDbValues.mockReturnValue({ onConflictDoUpdate: mockDbOnConflict });
    mockDbDeleteWhere.mockReturnValue(Promise.resolve());
  });

  it("get returns cache entry for valid non-expired hit", async () => {
    const hit = {
      keyHash: "key1",
      prompt: "test prompt",
      verdict: "approved",
      opinions: [{ text: "good" }],
      expiresAt: new Date(Date.now() + 100000),
      createdAt: new Date(),
    };
    mockDbLimit.mockResolvedValue([hit]);

    const result = await backend.get("key1");
    expect(result).toEqual({
      verdict: "approved",
      opinions: [{ text: "good" }],
      metadata: {
        prompt: "test prompt",
        createdAt: hit.createdAt,
      },
    });
  });

  it("get returns null when no hit found", async () => {
    mockDbLimit.mockResolvedValue([]);

    const result = await backend.get("missing");
    expect(result).toBeNull();
  });

  it("get returns null when entry is expired", async () => {
    const hit = {
      keyHash: "key1",
      prompt: "test",
      verdict: "old",
      opinions: [],
      expiresAt: new Date(Date.now() - 100000),
      createdAt: new Date(),
    };
    mockDbLimit.mockResolvedValue([hit]);

    const result = await backend.get("key1");
    expect(result).toBeNull();
  });

  it("set inserts entry with default TTL", async () => {
    mockDbOnConflict.mockResolvedValue(undefined);

    await backend.set("key1", { verdict: "ok", opinions: [] });
    expect(mockDbValues).toHaveBeenCalled();
    expect(mockDbOnConflict).toHaveBeenCalled();
  });

  it("set inserts entry with custom TTL", async () => {
    mockDbOnConflict.mockResolvedValue(undefined);

    await backend.set("key1", { verdict: "ok", opinions: [] }, 5000);
    expect(mockDbValues).toHaveBeenCalled();
  });

  it("delete removes entry (suppresses errors)", async () => {
    mockDbDeleteWhere.mockResolvedValue(undefined);

    await backend.delete("key1");
    expect(mockDbDeleteWhere).toHaveBeenCalled();
  });
});

describe("backends.ts re-exports", () => {
  it("exports RedisBackend and PostgresBackend", async () => {
    const exports = await import("../../../src/lib/cache/backends.js");
    expect(exports.RedisBackend).toBe(RedisBackend);
    expect(exports.PostgresBackend).toBe(PostgresBackend);
  });
});
