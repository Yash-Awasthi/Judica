import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Request, Response, NextFunction } from "express";

// ── Mocks — must be set before the module under test is imported ─────
vi.mock("../src/config/env.js", () => ({
  env: {
    RATE_LIMIT_WINDOW_MS: 60_000,
    REDIS_URL: "",
  },
}));

vi.mock("../src/lib/logger.js", () => ({
  default: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// Mock ioredis so the module-level Redis connection doesn't fail
vi.mock("ioredis", () => {
  const fake = vi.fn().mockImplementation(() => ({
    connect: vi.fn().mockResolvedValue(undefined),
    call: vi.fn(),
  }));
  return { default: { default: fake } };
});

vi.mock("rate-limit-redis", () => ({
  RedisStore: vi.fn().mockImplementation(() => ({})),
}));

import { askLimiter, authLimiter, apiLimiter } from "../src/middleware/rateLimit.js";

// ── Helpers ──────────────────────────────────────────────────────────
function makeReq(ip: string, overrides: Record<string, any> = {}): Request {
  return {
    ip,
    method: "GET",
    path: "/test",
    headers: {},
    socket: { remoteAddress: ip },
    ...overrides,
  } as unknown as Request;
}

function makeRes(): Response {
  const res: any = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
    send: vi.fn().mockReturnThis(),
    setHeader: vi.fn().mockReturnThis(),
    getHeader: vi.fn(),
    set: vi.fn().mockReturnThis(),
    header: vi.fn().mockReturnThis(),
  };
  return res as Response;
}

// ── Tests ────────────────────────────────────────────────────────────
describe("Rate Limiter — structure and configuration", () => {
  it("askLimiter should be a function (Express middleware)", () => {
    expect(typeof askLimiter).toBe("function");
  });

  it("authLimiter should be a function (Express middleware)", () => {
    expect(typeof authLimiter).toBe("function");
  });

  it("apiLimiter should be a function (Express middleware)", () => {
    expect(typeof apiLimiter).toBe("function");
  });
});

describe("Rate Limiter — askLimiter behaviour", () => {
  beforeEach(() => vi.clearAllMocks());

  it("should allow a single request through (within limit)", async () => {
    const req = makeReq("200.0.0.1");
    const res = makeRes();
    const next = vi.fn();

    // express-rate-limit is real middleware, call it once
    await new Promise<void>((resolve) => {
      askLimiter(req, res, ((err?: any) => {
        next(err);
        resolve();
      }) as NextFunction);
    });

    // next should be called (request allowed)
    expect(next).toHaveBeenCalled();
    // 429 should NOT have been sent
    expect(res.status).not.toHaveBeenCalledWith(429);
  });

  it("should enforce limit after max requests exceeded", async () => {
    const ip = "203.0.113.50";
    let lastStatus: number | undefined;
    let blocked = false;

    // Send 62 requests from same IP (limit is 60)
    for (let i = 0; i < 62; i++) {
      const req = makeReq(ip);
      const res = makeRes();
      res.status = vi.fn().mockImplementation((code: number) => {
        lastStatus = code;
        return res;
      }) as any;

      await new Promise<void>((resolve) => {
        askLimiter(req, res, (() => resolve()) as NextFunction);
        // If next wasn't called, the handler responded
        setTimeout(() => resolve(), 10);
      });

      if (lastStatus === 429) {
        blocked = true;
        break;
      }
    }

    expect(blocked).toBe(true);
  });

  it("should track different IPs independently", async () => {
    const ip1 = "198.51.100.1";
    const ip2 = "198.51.100.2";

    // Exhaust ip1 limit
    for (let i = 0; i < 61; i++) {
      const req = makeReq(ip1);
      const res = makeRes();
      await new Promise<void>((resolve) => {
        askLimiter(req, res, (() => resolve()) as NextFunction);
        setTimeout(() => resolve(), 5);
      });
    }

    // ip2 should still pass
    const req2 = makeReq(ip2);
    const res2 = makeRes();
    const next2 = vi.fn();

    await new Promise<void>((resolve) => {
      askLimiter(req2, res2, ((err?: any) => {
        next2(err);
        resolve();
      }) as NextFunction);
    });

    expect(next2).toHaveBeenCalled();
  });
});

describe("Rate Limiter — authLimiter stricter limit", () => {
  it("should block after 10 requests (stricter than ask)", async () => {
    const ip = "192.0.2.99";
    let blocked = false;

    for (let i = 0; i < 12; i++) {
      const req = makeReq(ip);
      const res = makeRes();
      let wasBlocked = false;

      res.status = vi.fn().mockImplementation((code: number) => {
        if (code === 429) wasBlocked = true;
        return res;
      }) as any;

      await new Promise<void>((resolve) => {
        authLimiter(req, res, (() => resolve()) as NextFunction);
        setTimeout(() => resolve(), 5);
      });

      if (wasBlocked) {
        blocked = true;
        break;
      }
    }

    expect(blocked).toBe(true);
  });
});
