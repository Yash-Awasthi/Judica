import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock logger to avoid console noise
vi.mock("../../src/lib/logger.js", () => ({
  default: { error: vi.fn(), info: vi.fn(), warn: vi.fn() }
}));

describe("Redis Utility wrapper", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("should initialize and connect on first call", async () => {
    const clientMock = {
      connect: vi.fn().mockResolvedValue(undefined),
      on: vi.fn(),
      ping: vi.fn().mockResolvedValue("PONG"),
    };
    vi.doMock("redis", () => ({
      createClient: vi.fn(() => clientMock),
    }));

    const { createClient } = await import("redis");
    const { default: redis } = await import("../../src/lib/redis.js");
    
    await redis.ping();
    expect(createClient).toHaveBeenCalled();
    expect(clientMock.connect).toHaveBeenCalled();
  });

  it("should handle get/set properly", async () => {
    const clientMock = {
      connect: vi.fn().mockResolvedValue(undefined),
      on: vi.fn(),
      get: vi.fn().mockResolvedValue("value"),
      set: vi.fn().mockResolvedValue("OK"),
    };
    vi.doMock("redis", () => ({
      createClient: vi.fn(() => clientMock),
    }));

    const { default: redis } = await import("../../src/lib/redis.js");
    
    const val = await redis.get("key");
    expect(val).toBe("value");
    expect(clientMock.get).toHaveBeenCalledWith("key");

    await redis.set("key", "value", { EX: 10 });
    expect(clientMock.set).toHaveBeenCalledWith("key", "value", { EX: 10 });
  });

  it("should handle del, ping, and quit", async () => {
    const clientMock = {
      connect: vi.fn().mockResolvedValue(undefined),
      on: vi.fn(),
      del: vi.fn().mockResolvedValue(1),
      ping: vi.fn().mockResolvedValue("PONG"),
      quit: vi.fn().mockResolvedValue("OK"),
    };
    vi.doMock("redis", () => ({
      createClient: vi.fn(() => clientMock),
    }));

    const { default: redis } = await import("../../src/lib/redis.js");

    expect(await redis.del("key")).toBe(1);
    expect(await redis.ping()).toBe("PONG");
    await redis.quit();
    expect(clientMock.quit).toHaveBeenCalled();
  });

  it("should handle ttl and pttl", async () => {
    const clientMock = {
      connect: vi.fn().mockResolvedValue(undefined),
      on: vi.fn(),
      pTTL: vi.fn().mockResolvedValue(1500),
    };
    vi.doMock("redis", () => ({
      createClient: vi.fn(() => clientMock),
    }));

    const { default: redis } = await import("../../src/lib/redis.js");

    expect(await redis.pttl("key")).toBe(1500);
    expect(await redis.ttl("key")).toBe(2);

    clientMock.pTTL.mockResolvedValue(-2);
    expect(await redis.ttl("missing")).toBe(-2);
  });

  it("should return defaults on connection failure", async () => {
    const clientMock = {
      connect: vi.fn().mockRejectedValue(new Error("Conn fail")),
      on: vi.fn(),
    };
    vi.doMock("redis", () => ({
      createClient: vi.fn(() => clientMock),
    }));

    const { default: redis } = await import("../../src/lib/redis.js");
    
    expect(await redis.get("k")).toBeNull();
    expect(await redis.ping()).toBe("PONG (fallback)");
  });

  it("should reconnect strategy should return correct values", async () => {
    const clientMock = {
      connect: vi.fn().mockResolvedValue(undefined),
      on: vi.fn(),
    };
    const createClientMock = vi.fn(() => clientMock);
    vi.doMock("redis", () => ({
      createClient: createClientMock,
    }));

    const { default: redis } = await import("../../src/lib/redis.js");
    await redis.get("k"); // Trigger init
    const config = createClientMock.mock.calls[0][0];
    const strategy = config.socket.reconnectStrategy;

    expect(strategy(1)).toBe(100);
    expect(strategy(10)).toBe(1000);
    expect(strategy(11)).toBeInstanceOf(Error);
  });

  it("should handle PX option in set", async () => {
    const clientMock = {
      connect: vi.fn().mockResolvedValue(undefined),
      on: vi.fn(),
      set: vi.fn().mockResolvedValue("OK"),
    };
    vi.doMock("redis", () => ({ createClient: vi.fn(() => clientMock) }));
    const { default: redis } = await import("../../src/lib/redis.js");

    await redis.set("key", "val", { PX: 100 });
    expect(clientMock.set).toHaveBeenCalledWith("key", "val", { PX: 100 });
  });

  it("should handle keys, flushAll, incr, decr, and expire", async () => {
    const clientMock = {
      connect: vi.fn().mockResolvedValue(undefined),
      on: vi.fn(),
      keys: vi.fn().mockResolvedValue(["k1", "k2"]),
      flushAll: vi.fn().mockResolvedValue("OK"),
      incr: vi.fn().mockResolvedValue(1),
      decr: vi.fn().mockResolvedValue(0),
      expire: vi.fn().mockResolvedValue(1),
    };
    vi.doMock("redis", () => ({ createClient: vi.fn(() => clientMock) }));
    const { default: redis } = await import("../../src/lib/redis.js");

    expect(await redis.keys("*")).toEqual(["k1", "k2"]);
    expect(await redis.flushAll()).toBe("OK");
    expect(await redis.incr("c")).toBe(1);
    expect(await redis.decr("c")).toBe(0);
    expect(await redis.expire("k", 10)).toBe(true);
  });

  it("should handle events and reconnection strategy", async () => {
    const onHandlers: Record<string, Function> = {};
    const clientMock = {
      connect: vi.fn().mockResolvedValue(undefined),
      on: vi.fn((event, cb) => { onHandlers[event] = cb; }),
    };
    const createClientMock = vi.fn(() => clientMock);
    vi.doMock("redis", () => ({ createClient: createClientMock }));
    const { default: redis } = await import("../../src/lib/redis.js");
    
    // Trigger init
    await redis.ping();

    // Trigger events
    onHandlers["error"](new Error("Redis error"));
    onHandlers["connect"]();
    onHandlers["reconnecting"]();
    onHandlers["ready"]();

    // Verify reconnection strategy
    const clientConfig = createClientMock.mock.calls[0][0];
    const strategy = clientConfig.socket.reconnectStrategy;
    expect(strategy(1)).toBe(100);
    expect(strategy(11)).toBeInstanceOf(Error);
  });
});
