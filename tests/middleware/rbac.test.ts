import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Response } from "express";
import type { AuthRequest } from "../../src/types/index.js";

vi.mock("dotenv/config", () => ({}));

const mockDbChain = {
  select: vi.fn().mockReturnThis(),
  from: vi.fn().mockReturnThis(),
  where: vi.fn().mockReturnThis(),
  limit: vi.fn().mockResolvedValue([]),
};

vi.mock("../../src/lib/drizzle.js", () => ({
  db: {
    select: (...a: any[]) => mockDbChain.select(...a),
    from: (...a: any[]) => mockDbChain.from(...a),
    where: (...a: any[]) => mockDbChain.where(...a),
    limit: (...a: any[]) => mockDbChain.limit(...a),
  },
}));
vi.mock("../../src/db/schema/users.js", () => ({ users: { id: "id", role: "role" } }));
vi.mock("drizzle-orm", () => ({ eq: vi.fn((...args: any[]) => args) }));
vi.mock("../../src/lib/logger.js", () => ({
  default: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { requireRole } from "../../src/middleware/rbac.js";

function makeReq(userId?: number): AuthRequest {
  return { userId } as AuthRequest;
}
function makeRes(): Response {
  return { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() } as unknown as Response;
}

describe("RBAC Middleware — requireRole", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDbChain.select.mockReturnValue(mockDbChain);
    mockDbChain.from.mockReturnValue(mockDbChain);
    mockDbChain.where.mockReturnValue(mockDbChain);
  });

  it("calls next() when user has admin role", async () => {
    mockDbChain.limit.mockResolvedValueOnce([{ role: "admin" }]);
    const next = vi.fn();
    await requireRole("admin")(makeReq(1) as any, makeRes(), next);
    expect(next).toHaveBeenCalledWith();
  });

  it("passes 403 error to next() when member accesses admin-only route", async () => {
    mockDbChain.limit.mockResolvedValueOnce([{ role: "member" }]);
    const next = vi.fn();
    await requireRole("admin")(makeReq(2) as any, makeRes(), next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 403 }));
  });

  it("passes 401 error to next() when userId is missing", async () => {
    const next = vi.fn();
    await requireRole("admin")(makeReq(undefined) as any, makeRes(), next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 401 }));
  });

  it("passes 403 error to next() when user not found in DB", async () => {
    mockDbChain.limit.mockResolvedValueOnce([]);
    const next = vi.fn();
    await requireRole("admin")(makeReq(999) as any, makeRes(), next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 403 }));
  });

  it("allows access when user role is in the allowed list", async () => {
    mockDbChain.limit.mockResolvedValueOnce([{ role: "editor" }]);
    const next = vi.fn();
    await requireRole("admin", "editor")(makeReq(3) as any, makeRes(), next);
    expect(next).toHaveBeenCalledWith();
  });
});
