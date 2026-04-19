import { describe, it, expect, vi, beforeEach } from "vitest";

const callArgs: any[][] = [];

vi.mock("ioredis", () => {
  class MockIORedis {
    status = "ready";
    constructor(...args: any[]) {
      callArgs.push(args);
    }
  }
  return { default: MockIORedis, Redis: MockIORedis };
});

describe("queue connection", () => {
  beforeEach(() => {
    callArgs.length = 0;
  });

  it("should create an IORedis instance with REDIS_URL", async () => {
    const mod = await import("../../src/queue/connection.js");
    const connection = mod.default;

    expect(callArgs.length).toBeGreaterThanOrEqual(1);
    const [url, opts] = callArgs[0];
    expect(url).toMatch(/redis/);
    expect(opts).toEqual(
      expect.objectContaining({ maxRetriesPerRequest: null })
    );
    expect(connection).toBeDefined();
    expect(connection.status).toBe("ready");
  });
});
