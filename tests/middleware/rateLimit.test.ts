import { describe, it, expect, vi, beforeEach } from "vitest";
import rateLimit from "express-rate-limit";

// ── Hoist all mocks so they run before any imports ────────────────────────────

vi.mock("express-rate-limit", () => ({
  default: vi.fn((options) => ({
    options,
    middleware: (req: any, res: any, next: any) => next(),
  })),
}));

vi.mock("../../src/config/env.js", () => ({
  env: {
    RATE_LIMIT_WINDOW_MS: 60_000,
    REDIS_URL: "redis://localhost:6379",
  },
}));

vi.mock("../../src/lib/logger.js", () => ({
  default: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// Mock ioredis so the lazyConnect client doesn't actually connect
vi.mock("ioredis", () => ({
  default: class MockIORedis {
    connect = vi.fn().mockResolvedValue(undefined);
    quit   = vi.fn().mockResolvedValue("OK");
    call   = vi.fn().mockResolvedValue(1);
  },
}));

// Mock rate-limit-redis RedisStore so it doesn't run Lua script loading
vi.mock("rate-limit-redis", () => ({
  RedisStore: class MockRedisStore {
    constructor() {}
    async increment(_key: string) { return { totalHits: 1, resetTime: new Date() }; }
    async decrement(_key: string) {}
    async resetKey(_key: string) {}
  },
}));

// ─────────────────────────────────────────────────────────────────────────────

describe("Rate Limit Middleware", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should initialize all limiters (askLimiter, authLimiter, apiLimiter)", async () => {
    const { askLimiter, authLimiter, apiLimiter, sandboxLimiter, voiceLimiter } =
      await import("../../src/middleware/rateLimit.js");

    expect(askLimiter).toBeDefined();
    expect(authLimiter).toBeDefined();
    expect(apiLimiter).toBeDefined();
    expect(sandboxLimiter).toBeDefined();
    expect(voiceLimiter).toBeDefined();
  });

  it("should use correct keyGenerator (ip vs user-scoped)", async () => {
    const { askLimiter } = await import("../../src/middleware/rateLimit.js");

    // Our express-rate-limit mock stores options on the returned object
    const keyGen = (askLimiter as any).options.keyGenerator;

    // Plain IP fallback
    expect(keyGen({ ip: "1.2.3.4" })).toBe("1.2.3.4");
    // User-scoped key
    expect(keyGen({ userId: 42, ip: "1.2.3.4" })).toBe("user:42:1.2.3.4");
  });

  it("should expose cleanupRateLimitRedis that resolves", async () => {
    const { cleanupRateLimitRedis } = await import("../../src/middleware/rateLimit.js");
    await expect(cleanupRateLimitRedis()).resolves.toBeUndefined();
  });
});
