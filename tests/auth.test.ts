import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Response, NextFunction } from "express";
import type { AuthRequest } from "../src/types/index.js";

// ── Mocks ────────────────────────────────────────────────────────────
vi.mock("../src/config/env.js", () => ({
  env: {
    JWT_SECRET: "test-jwt-secret-min-16-chars",
  },
}));

vi.mock("../src/lib/drizzle.js", () => ({
  db: {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock("../src/db/schema/auth.js", () => ({
  revokedTokens: { token: "token" },
}));

vi.mock("../src/lib/redis.js", () => ({
  default: {
    get: vi.fn().mockResolvedValue(null),
  },
}));

vi.mock("../src/lib/logger.js", () => ({
  default: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// We need a real-ish jwt module to create tokens, but we also test mocked paths.
import jwt from "jsonwebtoken";

const JWT_SECRET = "test-jwt-secret-min-16-chars";

// ── Helpers ──────────────────────────────────────────────────────────
function makeReq(authHeader?: string): AuthRequest {
  return {
    headers: { authorization: authHeader },
    path: "/test",
  } as unknown as AuthRequest;
}

function makeRes() {
  const res: Partial<Response> = {
    status: vi.fn().mockReturnThis() as any,
    json: vi.fn().mockReturnThis() as any,
  };
  return res as Response;
}

const nextFn: NextFunction = vi.fn();

// ── Tests ────────────────────────────────────────────────────────────
describe("Auth Middleware — requireAuth", () => {
  let requireAuth: typeof import("../src/middleware/auth.js")["requireAuth"];

  beforeEach(async () => {
    vi.clearAllMocks();
    // Re-import to get fresh module with mocks applied
    const mod = await import("../src/middleware/auth.js");
    requireAuth = mod.requireAuth;
  });

  // 1. Valid JWT ─────────────────────────────────────────────────────
  it("should authenticate a valid HS256 token and call next()", async () => {
    const token = jwt.sign({ userId: 42, username: "alice" }, JWT_SECRET, {
      algorithm: "HS256",
      expiresIn: "1h",
    });
    const req = makeReq(`Bearer ${token}`);
    const res = makeRes();

    await requireAuth(req, res, nextFn);

    expect(nextFn).toHaveBeenCalled();
    expect(req.userId).toBe(42);
    expect(req.username).toBe("alice");
    expect(res.status).not.toHaveBeenCalled();
  });

  // 2. Expired token ─────────────────────────────────────────────────
  it("should reject an expired token with 401", async () => {
    const token = jwt.sign({ userId: 1, username: "bob" }, JWT_SECRET, {
      algorithm: "HS256",
      expiresIn: "-1s", // already expired
    });
    const req = makeReq(`Bearer ${token}`);
    const res = makeRes();

    await requireAuth(req, res, nextFn);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: "Invalid or expired token" });
  });

  // 3. Wrong algorithm (HS384 instead of HS256) ──────────────────────
  it("should reject a token signed with wrong algorithm", async () => {
    const token = jwt.sign({ userId: 1, username: "eve" }, JWT_SECRET, {
      algorithm: "HS384",
    });
    const req = makeReq(`Bearer ${token}`);
    const res = makeRes();

    await requireAuth(req, res, nextFn);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: "Invalid or expired token" });
  });

  // 4. Malformed payload (missing userId) ────────────────────────────
  it("should reject a token with malformed payload (missing userId)", async () => {
    // Sign a payload that lacks the required `userId` field
    const token = jwt.sign({ username: "nouser" }, JWT_SECRET, {
      algorithm: "HS256",
    });
    const req = makeReq(`Bearer ${token}`);
    const res = makeRes();

    await requireAuth(req, res, nextFn);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: "Invalid or expired token" });
  });

  // 5. Missing Authorization header ─────────────────────────────────
  it("should return 401 when Authorization header is missing", async () => {
    const req = makeReq(undefined);
    const res = makeRes();

    await requireAuth(req, res, nextFn);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: "Authentication required" });
  });

  // 6. Malformed header (no "Bearer " prefix) ───────────────────────
  it("should return 401 when header lacks Bearer prefix", async () => {
    const token = jwt.sign({ userId: 1, username: "x" }, JWT_SECRET, {
      algorithm: "HS256",
    });
    const req = makeReq(token); // no "Bearer " prefix
    const res = makeRes();

    await requireAuth(req, res, nextFn);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: "Authentication required" });
  });

  // 7. Token signed with wrong secret ───────────────────────────────
  it("should reject a token signed with a different secret", async () => {
    const token = jwt.sign({ userId: 1, username: "x" }, "wrong-secret-value-here", {
      algorithm: "HS256",
    });
    const req = makeReq(`Bearer ${token}`);
    const res = makeRes();

    await requireAuth(req, res, nextFn);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: "Invalid or expired token" });
  });
});
