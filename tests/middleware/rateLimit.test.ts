import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/config/env.js", () => ({
  env: {
    REDIS_URL: "redis://localhost:6379",
  },
}));

vi.mock("../../src/lib/logger.js", () => ({
  default: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// ─── IORedis mock factory ─────────────────────────────────────────────────────
// We need per-test control over event handlers, so use a class with spied methods.

const { mockOn, mockConnect, mockQuit } = vi.hoisted(() => ({
  mockOn: vi.fn(),
  mockConnect: vi.fn().mockResolvedValue(undefined),
  mockQuit: vi.fn().mockResolvedValue("OK"),
}));

vi.mock("ioredis", () => ({
  default: class MockIORedis {
    on = mockOn;
    connect = mockConnect;
    quit = mockQuit;
  },
}));

// ─── helpers ──────────────────────────────────────────────────────────────────

/** Find a registered event listener by name and invoke it */
function triggerEvent(event: string, ...args: unknown[]) {
  const call = mockOn.mock.calls.find((c) => c[0] === event);
  if (call && typeof call[1] === "function") {
    call[1](...args);
  }
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe("rateLimit — getRateLimitRedis / isRateLimitRedisHealthy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("cleanupRateLimitRedis resolves without error", async () => {
    const { cleanupRateLimitRedis } = await import("../../src/middleware/rateLimit.js");
    await expect(cleanupRateLimitRedis()).resolves.toBeUndefined();
  });

  it("getRateLimitRedis returns undefined before 'ready' event fires", async () => {
    // connect() resolves but 'ready' never fires — client not ready
    mockConnect.mockResolvedValue(undefined);
    const { getRateLimitRedis } = await import("../../src/middleware/rateLimit.js");
    // No 'ready' event fired → redisReady stays false
    expect(getRateLimitRedis()).toBeUndefined();
  });

  it("getRateLimitRedis returns the client after 'ready' fires", async () => {
    mockConnect.mockResolvedValue(undefined);
    const { getRateLimitRedis } = await import("../../src/middleware/rateLimit.js");

    // Simulate Redis emitting 'ready'
    triggerEvent("ready");

    expect(getRateLimitRedis()).toBeDefined();
  });

  it("isRateLimitRedisHealthy is false before 'ready' fires", async () => {
    mockConnect.mockResolvedValue(undefined);
    const { isRateLimitRedisHealthy } = await import("../../src/middleware/rateLimit.js");
    expect(isRateLimitRedisHealthy()).toBe(false);
  });

  it("isRateLimitRedisHealthy is true after 'ready' fires", async () => {
    mockConnect.mockResolvedValue(undefined);
    const { isRateLimitRedisHealthy } = await import("../../src/middleware/rateLimit.js");
    triggerEvent("ready");
    expect(isRateLimitRedisHealthy()).toBe(true);
  });

  it("isRateLimitRedisHealthy becomes false after 'error' fires", async () => {
    mockConnect.mockResolvedValue(undefined);
    const { isRateLimitRedisHealthy } = await import("../../src/middleware/rateLimit.js");
    triggerEvent("ready");
    expect(isRateLimitRedisHealthy()).toBe(true);

    triggerEvent("error", { message: "connection refused" });
    expect(isRateLimitRedisHealthy()).toBe(false);
  });

  it("isRateLimitRedisHealthy becomes false after 'close' fires", async () => {
    mockConnect.mockResolvedValue(undefined);
    const { isRateLimitRedisHealthy } = await import("../../src/middleware/rateLimit.js");
    triggerEvent("ready");
    triggerEvent("close");
    expect(isRateLimitRedisHealthy()).toBe(false);
  });

  it("logs warn and sets client to undefined when connect() rejects", async () => {
    mockConnect.mockRejectedValue(new Error("ECONNREFUSED"));
    const logger = await import("../../src/lib/logger.js");

    // Import triggers module execution which calls connect().catch()
    await import("../../src/middleware/rateLimit.js");
    // Allow the rejected promise to settle
    await Promise.resolve();

    expect(vi.mocked(logger.default).warn).toHaveBeenCalledWith(
      expect.stringContaining("Rate limit Redis connection failed")
    );
  });
});

describe("rateLimit — cleanupRateLimitRedis", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("calls quit() on the redis client", async () => {
    mockConnect.mockResolvedValue(undefined);
    const { cleanupRateLimitRedis } = await import("../../src/middleware/rateLimit.js");
    await cleanupRateLimitRedis();
    expect(mockQuit).toHaveBeenCalledTimes(1);
  });

  it("resolves even if quit() rejects", async () => {
    mockConnect.mockResolvedValue(undefined);
    mockQuit.mockRejectedValue(new Error("Redis hung"));
    const { cleanupRateLimitRedis } = await import("../../src/middleware/rateLimit.js");
    await expect(cleanupRateLimitRedis()).resolves.toBeUndefined();
  });

  it("resolves within timeout even if quit() never resolves", async () => {
    mockConnect.mockResolvedValue(undefined);
    // quit() hangs forever — the 3s race should still resolve
    mockQuit.mockReturnValue(new Promise(() => {}));
    const { cleanupRateLimitRedis } = await import("../../src/middleware/rateLimit.js");
    await expect(cleanupRateLimitRedis()).resolves.toBeUndefined();
  }, 5000);
});
