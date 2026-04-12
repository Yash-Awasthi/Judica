import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Response, NextFunction } from "express";
import type { AuthRequest } from "../src/types/index.js";

// ── Mocks ────────────────────────────────────────────────────────────
const mockDbChain = {
  select: vi.fn().mockReturnThis(),
  from: vi.fn().mockReturnThis(),
  where: vi.fn().mockReturnThis(),
  limit: vi.fn().mockResolvedValue([]),
};

vi.mock("../src/lib/drizzle.js", () => ({
  db: {
    select: (...a: any[]) => mockDbChain.select(...a),
    from: (...a: any[]) => mockDbChain.from(...a),
    where: (...a: any[]) => mockDbChain.where(...a),
    limit: (...a: any[]) => mockDbChain.limit(...a),
  },
}));

vi.mock("../src/db/schema/users.js", () => ({
  users: { id: "id", role: "role" },
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((...args: any[]) => args),
}));

// AppError is a real class — we need to import it, but mock its dependency
vi.mock("../src/lib/logger.js", () => ({
  default: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { requireRole } from "../src/middleware/rbac.js";
import { AppError } from "../src/middleware/errorHandler.js";

// ── Helpers ──────────────────────────────────────────────────────────
function makeReq(userId?: number): AuthRequest {
  return { userId } as AuthRequest;
}

function makeRes(): Response {
  return {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  } as unknown as Response;
}

// ── Tests ────────────────────────────────────────────────────────────
describe("RBAC Middleware — requireRole", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset the chain so each call starts fresh
    mockDbChain.select.mockReturnValue(mockDbChain);
    mockDbChain.from.mockReturnValue(mockDbChain);
    mockDbChain.where.mockReturnValue(mockDbChain);
  });

  // 1. Admin role granted ────────────────────────────────────────────
  it("should call next() when user has admin role", async () => {
    mockDbChain.limit.mockResolvedValueOnce([{ role: "admin" }]);

    const middleware = requireRole("admin");
    const req = makeReq(1);
    const res = makeRes();
    const next = vi.fn();

    await middleware(req as any, res, next);

    expect(next).toHaveBeenCalled();
  });

  // 2. Member denied on admin-only route ─────────────────────────────
  it("should throw 403 when member accesses admin-only route", async () => {
    mockDbChain.limit.mockResolvedValueOnce([{ role: "member" }]);

    const middleware = requireRole("admin");
    const req = makeReq(2);
    const res = makeRes();
    const next = vi.fn();

    await expect(middleware(req as any, res, next)).rejects.toThrow(AppError);
    await expect(middleware(req as any, res, next)).rejects.toThrow("Insufficient permissions");
  });

  // 3. Missing userId (not authenticated) ────────────────────────────
  it("should throw 401 when userId is missing from request", async () => {
    const middleware = requireRole("admin");
    const req = makeReq(undefined);
    const res = makeRes();
    const next = vi.fn();

    await expect(middleware(req as any, res, next)).rejects.toThrow(AppError);
    await expect(middleware(req as any, res, next)).rejects.toThrow("Not authenticated");
  });

  // 4. User not found in DB ──────────────────────────────────────────
  it("should throw 403 when user is not found in database", async () => {
    mockDbChain.limit.mockResolvedValueOnce([]); // no user row

    const middleware = requireRole("admin");
    const req = makeReq(999);
    const res = makeRes();
    const next = vi.fn();

    await expect(middleware(req as any, res, next)).rejects.toThrow(AppError);
  });

  // 5. Multiple allowed roles ────────────────────────────────────────
  it("should allow access when user role is in the allowed list", async () => {
    mockDbChain.limit.mockResolvedValueOnce([{ role: "editor" }]);

    const middleware = requireRole("admin", "editor");
    const req = makeReq(3);
    const res = makeRes();
    const next = vi.fn();

    await middleware(req as any, res, next);

    expect(next).toHaveBeenCalled();
  });
});
