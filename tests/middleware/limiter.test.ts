import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/lib/redis.js", () => ({
  default: {
    ping: vi.fn().mockRejectedValue(new Error("Redis unavailable")),
    incr: vi.fn().mockRejectedValue(new Error("Redis unavailable")),
    expire: vi.fn().mockRejectedValue(new Error("Redis unavailable")),
    pttl: vi.fn().mockRejectedValue(new Error("Redis unavailable")),
    decr: vi.fn().mockRejectedValue(new Error("Redis unavailable")),
    get: vi.fn().mockRejectedValue(new Error("Redis unavailable")),
  },
}));

vi.mock("../../src/lib/logger.js", () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import { perUserLimiter } from "../../src/middleware/limiter.js";

function createMocks(userId?: number) {
  const finishCallbacks: Array<() => void> = [];
  const closeCallbacks: Array<() => void> = [];
  const req: any = { userId };
  const res: any = {
    locals: {},
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
    setHeader: vi.fn(),
    on: vi.fn((event: string, cb: () => void) => {
      if (event === "finish") finishCallbacks.push(cb);
      if (event === "close") closeCallbacks.push(cb);
    }),
  };
  const next = vi.fn();
  return {
    req,
    res,
    next,
    triggerFinish: () => finishCallbacks.forEach((cb) => cb()),
    triggerClose: () => closeCallbacks.forEach((cb) => cb()),
  };
}

describe("perUserLimiter (in-memory fallback)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls next if no userId", async () => {
    const { req, res, next } = createMocks(undefined);
    await perUserLimiter(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });

  it("calls next for a valid request under limits", async () => {
    const { req, res, next } = createMocks(1001);
    await perUserLimiter(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });

  it("returns 429 when RPM is exceeded", async () => {
    const userId = 2001;

    // Make 1000 requests (the limit)
    for (let i = 0; i < 1000; i++) {
      const { req, res, next, triggerFinish } = createMocks(userId);
      await perUserLimiter(req, res, next);
      triggerFinish(); // release concurrency
    }

    // The 1001st request should be rate limited
    const { req, res, next } = createMocks(userId);
    await perUserLimiter(req, res, next);

    expect(res.status).toHaveBeenCalledWith(429);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.stringContaining("Too many requests") })
    );
    expect(next).not.toHaveBeenCalled();
  });

  it("returns 429 when concurrency is exceeded", async () => {
    const userId = 3001;

    // Open 100 concurrent requests (the limit) without finishing them
    for (let i = 0; i < 100; i++) {
      const { req, res, next } = createMocks(userId);
      await perUserLimiter(req, res, next);
      // Do NOT triggerFinish — keep them open
    }

    // The 101st concurrent request should be rejected
    const { req, res, next } = createMocks(userId);
    await perUserLimiter(req, res, next);

    expect(res.status).toHaveBeenCalledWith(429);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.stringContaining("simultaneous requests") })
    );
    expect(next).not.toHaveBeenCalled();
  });

  it("decrements concurrency on finish", async () => {
    const userId = 4001;

    // Open max concurrent requests
    const handles: Array<{ triggerFinish: () => void }> = [];
    for (let i = 0; i < 100; i++) {
      const mock = createMocks(userId);
      await perUserLimiter(mock.req, mock.res, mock.next);
      handles.push(mock);
    }

    // Should be rejected now
    const rejected = createMocks(userId);
    await perUserLimiter(rejected.req, rejected.res, rejected.next);
    expect(rejected.res.status).toHaveBeenCalledWith(429);

    // Finish one request to free a slot
    handles[0].triggerFinish();

    // Now a new request should succeed
    const accepted = createMocks(userId);
    await perUserLimiter(accepted.req, accepted.res, accepted.next);
    expect(accepted.next).toHaveBeenCalledOnce();
    expect(accepted.res.status).not.toHaveBeenCalled();
  });
});
