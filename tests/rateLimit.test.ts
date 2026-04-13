import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Request, Response, NextFunction } from "express";

vi.mock("../src/config/env.js", () => ({
  env: { RATE_LIMIT_WINDOW_MS: 60_000, REDIS_URL: "" },
}));
vi.mock("../src/lib/logger.js", () => ({
  default: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("ioredis", () => {
  const fake = vi.fn().mockImplementation(() => ({
    connect: vi.fn().mockResolvedValue(undefined),
    call: vi.fn(),
  }));
  return { default: { default: fake } };
});
vi.mock("rate-limit-redis", () => ({ RedisStore: vi.fn().mockImplementation(() => ({})) }));

import { askLimiter, authLimiter, apiLimiter } from "../src/middleware/rateLimit.js";

function makeReq(ip: string): Request {
  return { ip, method: "GET", path: "/test", headers: {}, socket: { remoteAddress: ip } } as unknown as Request;
}
function makeRes(): Response {
  return {
    status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis(),
    send: vi.fn().mockReturnThis(), setHeader: vi.fn().mockReturnThis(),
    getHeader: vi.fn(), set: vi.fn().mockReturnThis(), header: vi.fn().mockReturnThis(),
  } as unknown as Response;
}

function callMiddleware(mw: any, req: Request, res: Response): Promise<boolean> {
  return new Promise((resolve) => {
    mw(req, res, () => resolve(true));
    setTimeout(() => resolve(false), 10);
  });
}

describe("Rate Limiter", () => {
  it("exports middleware functions", () => {
    expect(typeof askLimiter).toBe("function");
    expect(typeof authLimiter).toBe("function");
    expect(typeof apiLimiter).toBe("function");
  });

  it("allows a single request through", async () => {
    const allowed = await callMiddleware(askLimiter, makeReq("200.0.0.1"), makeRes());
    expect(allowed).toBe(true);
  });

  it("blocks after exceeding ask limit (60/min)", async () => {
    const ip = "203.0.113.50";
    let blocked = false;
    for (let i = 0; i < 62; i++) {
      const res = makeRes();
      let statusCode: number | undefined;
      res.status = vi.fn().mockImplementation((code: number) => { statusCode = code; return res; }) as any;
      await callMiddleware(askLimiter, makeReq(ip), res);
      if (statusCode === 429) { blocked = true; break; }
    }
    expect(blocked).toBe(true);
  });

  it("blocks after exceeding auth limit (10/min)", async () => {
    const ip = "192.0.2.99";
    let blocked = false;
    for (let i = 0; i < 12; i++) {
      const res = makeRes();
      let statusCode: number | undefined;
      res.status = vi.fn().mockImplementation((code: number) => { statusCode = code; return res; }) as any;
      await callMiddleware(authLimiter, makeReq(ip), res);
      if (statusCode === 429) { blocked = true; break; }
    }
    expect(blocked).toBe(true);
  });

  it("tracks different IPs independently", async () => {
    // Exhaust ip1
    for (let i = 0; i < 61; i++) {
      await callMiddleware(askLimiter, makeReq("198.51.100.1"), makeRes());
    }
    // ip2 should still pass
    const allowed = await callMiddleware(askLimiter, makeReq("198.51.100.2"), makeRes());
    expect(allowed).toBe(true);
  });
});
