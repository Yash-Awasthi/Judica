import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Response, NextFunction } from "express";
import type { AuthRequest } from "../src/types/index.js";
import jwt from "jsonwebtoken";

const JWT_SECRET = "test-jwt-secret-min-16-chars";

vi.mock("../src/config/env.js", () => ({
  env: { JWT_SECRET: "test-jwt-secret-min-16-chars" },
}));
vi.mock("../src/lib/drizzle.js", () => ({
  db: { select: vi.fn().mockReturnThis(), from: vi.fn().mockReturnThis(), where: vi.fn().mockReturnThis(), limit: vi.fn().mockResolvedValue([]) },
}));
vi.mock("../src/db/schema/auth.js", () => ({ revokedTokens: { token: "token" } }));
vi.mock("../src/lib/redis.js", () => ({ default: { get: vi.fn().mockResolvedValue(null) } }));
vi.mock("../src/lib/logger.js", () => ({
  default: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

function makeReq(authHeader?: string): AuthRequest {
  return { headers: { authorization: authHeader }, path: "/test" } as unknown as AuthRequest;
}
function makeRes(): Response {
  return { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() } as unknown as Response;
}

describe("Auth Middleware — requireAuth", () => {
  let requireAuth: typeof import("../src/middleware/auth.js")["requireAuth"];

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import("../src/middleware/auth.js");
    requireAuth = mod.requireAuth;
  });

  it("authenticates a valid HS256 token", async () => {
    const token = jwt.sign({ userId: 42, username: "alice" }, JWT_SECRET, { algorithm: "HS256", expiresIn: "1h" });
    const req = makeReq(`Bearer ${token}`);
    const res = makeRes();
    const next = vi.fn();
    await requireAuth(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(req.userId).toBe(42);
    expect(req.username).toBe("alice");
  });

  it("rejects an expired token", async () => {
    const token = jwt.sign({ userId: 1, username: "bob" }, JWT_SECRET, { algorithm: "HS256", expiresIn: "-1s" });
    const req = makeReq(`Bearer ${token}`);
    const res = makeRes();
    await requireAuth(req, res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it("rejects a token signed with wrong algorithm", async () => {
    const token = jwt.sign({ userId: 1, username: "eve" }, JWT_SECRET, { algorithm: "HS384" });
    const req = makeReq(`Bearer ${token}`);
    const res = makeRes();
    await requireAuth(req, res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it("rejects a token missing userId", async () => {
    const token = jwt.sign({ username: "nouser" }, JWT_SECRET, { algorithm: "HS256" });
    const req = makeReq(`Bearer ${token}`);
    const res = makeRes();
    await requireAuth(req, res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it("returns 401 when Authorization header is missing", async () => {
    const res = makeRes();
    await requireAuth(makeReq(undefined), res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it("returns 401 when header lacks Bearer prefix", async () => {
    const token = jwt.sign({ userId: 1, username: "x" }, JWT_SECRET, { algorithm: "HS256" });
    const res = makeRes();
    await requireAuth(makeReq(token), res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it("rejects a token signed with wrong secret", async () => {
    const token = jwt.sign({ userId: 1, username: "x" }, "wrong-secret-value-here", { algorithm: "HS256" });
    const res = makeRes();
    await requireAuth(makeReq(`Bearer ${token}`), res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(401);
  });
});
