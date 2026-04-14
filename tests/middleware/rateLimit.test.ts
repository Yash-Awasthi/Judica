import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/config/env.js", () => ({
  env: {
    REDIS_URL: "redis://localhost:6379",
  },
}));

vi.mock("../../src/lib/logger.js", () => ({
  default: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("ioredis", () => ({
  default: class MockIORedis {
    connect = vi.fn().mockResolvedValue(undefined);
    quit   = vi.fn().mockResolvedValue("OK");
    call   = vi.fn().mockResolvedValue(1);
  },
}));

describe("Rate Limit Redis cleanup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should expose cleanupRateLimitRedis that resolves", async () => {
    const { cleanupRateLimitRedis } = await import("../../src/middleware/rateLimit.js");
    await expect(cleanupRateLimitRedis()).resolves.toBeUndefined();
  });
});
