import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock logger to avoid console noise
vi.mock("../../src/lib/logger.js", () => ({
  default: { error: vi.fn(), info: vi.fn(), warn: vi.fn() }
}));

// Mock env
vi.mock("../../src/config/env.js", () => ({
  env: { REDIS_URL: "redis://localhost:6379" }
}));

describe("Redis Utility wrapper", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("should initialize and connect on first call", async () => {
    const clientMock = {
      status: "ready",
      connect: vi.fn().mockResolvedValue(undefined),
      on: vi.fn(),
      ping: vi.fn().mockResolvedValue("PONG"),
      get: vi.fn().mockResolvedValue(null),
    };
    vi.doMock("ioredis", () => ({
      Redis: function() { return clientMock; },
    }));

    const { default: redis } = await import("../../src/lib/redis.js");

    const result = await redis.ping();
    expect(result).toBe("PONG");
  });

  it("should handle get/set properly", async () => {
    const clientMock = {
      status: "ready",
      connect: vi.fn().mockResolvedValue(undefined),
      on: vi.fn(),
      get: vi.fn().mockResolvedValue("value"),
      set: vi.fn().mockResolvedValue("OK"),
    };
    vi.doMock("ioredis", () => ({
      Redis: function() { return clientMock; },
    }));

    const { default: redis } = await import("../../src/lib/redis.js");

    const val = await redis.get("key");
    expect(val).toBe("value");
    expect(clientMock.get).toHaveBeenCalledWith("key");

    await redis.set("key", "value", { EX: 10 });
    expect(clientMock.set).toHaveBeenCalledWith("key", "value", "EX", 10);
  });

  it("should handle del, ping, and quit", async () => {
    const clientMock = {
      status: "ready",
      connect: vi.fn().mockResolvedValue(undefined),
      on: vi.fn(),
      del: vi.fn().mockResolvedValue(1),
      ping: vi.fn().mockResolvedValue("PONG"),
      quit: vi.fn().mockResolvedValue("OK"),
    };
    vi.doMock("ioredis", () => ({
      Redis: function() { return clientMock; },
    }));

    const { default: redis } = await import("../../src/lib/redis.js");

    expect(await redis.del("key")).toBe(1);
    expect(await redis.ping()).toBe("PONG");
    await redis.quit();
    expect(clientMock.quit).toHaveBeenCalled();
  });

  it("should handle ttl and pttl", async () => {
    const clientMock = {
      status: "ready",
      connect: vi.fn().mockResolvedValue(undefined),
      on: vi.fn(),
      pttl: vi.fn().mockResolvedValue(1500),
    };
    vi.doMock("ioredis", () => ({
      Redis: function() { return clientMock; },
    }));

    const { default: redis } = await import("../../src/lib/redis.js");

    expect(await redis.pttl("key")).toBe(1500);
    expect(await redis.ttl("key")).toBe(2); // Math.ceil(1500/1000)

    clientMock.pttl.mockResolvedValue(-2);
    expect(await redis.ttl("missing")).toBe(-2);
  });

  it("should return defaults on connection failure", async () => {
    const clientMock = {
      status: "connecting",
      connect: vi.fn().mockRejectedValue(new Error("Conn fail")),
      on: vi.fn(),
      get: vi.fn().mockRejectedValue(new Error("not connected")),
      ping: vi.fn().mockRejectedValue(new Error("not connected")),
    };
    vi.doMock("ioredis", () => ({
      Redis: function() { return clientMock; },
    }));

    const { default: redis } = await import("../../src/lib/redis.js");

    expect(await redis.get("k")).toBeNull();
    expect(await redis.ping()).toBe("PONG (fallback)");
  });

  it("should have reconnect strategy with correct values", async () => {
    let capturedConfig: any;
    vi.doMock("ioredis", () => ({
      Redis: function(_url: string, config: any) {
        capturedConfig = config;
        return {
          status: "ready",
          connect: vi.fn().mockResolvedValue(undefined),
          on: vi.fn(),
          get: vi.fn().mockResolvedValue(null),
        };
      },
    }));

    const { default: redis } = await import("../../src/lib/redis.js");
    await redis.get("k"); // Trigger init

    const strategy = capturedConfig.retryStrategy;
    expect(strategy(1)).toBe(100);
    expect(strategy(10)).toBe(1000);
    expect(strategy(11)).toBeNull(); // ioredis returns null to stop retrying
  });

  it("should handle PX option in set", async () => {
    const clientMock = {
      status: "ready",
      connect: vi.fn().mockResolvedValue(undefined),
      on: vi.fn(),
      set: vi.fn().mockResolvedValue("OK"),
    };
    vi.doMock("ioredis", () => ({
      Redis: function() { return clientMock; },
    }));
    const { default: redis } = await import("../../src/lib/redis.js");

    await redis.set("key", "val", { PX: 100 });
    expect(clientMock.set).toHaveBeenCalledWith("key", "val", "PX", 100);
  });

  it("should handle keys (via SCAN), flushAll, incr, decr, and expire", async () => {
    const clientMock = {
      status: "ready",
      connect: vi.fn().mockResolvedValue(undefined),
      on: vi.fn(),
      scan: vi.fn().mockResolvedValue(["0", ["k1", "k2"]]),
      flushall: vi.fn().mockResolvedValue("OK"),
      incr: vi.fn().mockResolvedValue(1),
      decr: vi.fn().mockResolvedValue(0),
      expire: vi.fn().mockResolvedValue(1),
    };
    vi.doMock("ioredis", () => ({
      Redis: function() { return clientMock; },
    }));
    const { default: redis } = await import("../../src/lib/redis.js");

    expect(await redis.keys("*")).toEqual(["k1", "k2"]);
    // flushAll requires DANGER_CONFIRM flag
    expect(await redis.flushAll({ DANGER_CONFIRM: true })).toBe("OK");
    expect(await redis.incr("c")).toBe(1);
    expect(await redis.decr("c")).toBe(0);
    expect(await redis.expire("k", 10)).toBe(true);
  });

  it("should handle events via ioredis on() handlers", async () => {
    const onHandlers: Record<string, Function> = {};
    const clientMock = {
      status: "ready",
      connect: vi.fn().mockResolvedValue(undefined),
      on: vi.fn((event: string, cb: Function) => { onHandlers[event] = cb; }),
      ping: vi.fn().mockResolvedValue("PONG"),
    };
    vi.doMock("ioredis", () => ({
      Redis: function() { return clientMock; },
    }));
    const { default: redis } = await import("../../src/lib/redis.js");

    // Trigger init
    await redis.ping();

    // Verify event handlers were registered
    expect(clientMock.on).toHaveBeenCalledWith("error", expect.any(Function));
    expect(clientMock.on).toHaveBeenCalledWith("connect", expect.any(Function));
    expect(clientMock.on).toHaveBeenCalledWith("reconnecting", expect.any(Function));
    expect(clientMock.on).toHaveBeenCalledWith("ready", expect.any(Function));

    // Trigger events (should not throw)
    onHandlers["error"]?.(new Error("Redis error"));
    onHandlers["connect"]?.();
    onHandlers["reconnecting"]?.();
    onHandlers["ready"]?.();
  });
});
