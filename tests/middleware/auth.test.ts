import { describe, it, expect, vi, beforeEach } from "vitest";
import { requireAuth, optionalAuth } from "../../src/middleware/auth.js";
import jwt from "jsonwebtoken";
import { db } from "../../src/lib/drizzle.js";
import redis from "../../src/lib/redis.js";
import { env } from "../../src/config/env.js";

vi.mock("jsonwebtoken", () => ({
  default: {
    verify: vi.fn(),
  },
  verify: vi.fn(),
}));
vi.mock("../../src/lib/drizzle.js", () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn().mockResolvedValue([])
        }))
      }))
    })),
  }
}));
vi.mock("../../src/lib/redis.js", () => ({
  default: { get: vi.fn().mockResolvedValue(null) },
  get: vi.fn().mockResolvedValue(null),
}));
vi.mock("../../src/config/env.js", () => ({
  env: { JWT_SECRET: "test-secret" }
}));
vi.mock("../../src/lib/logger.js", () => ({
  default: { debug: vi.fn() },
  debug: vi.fn(),
}));

describe("Auth Middleware", () => {
  let req: any;
  let res: any;
  let next: any;

  beforeEach(() => {
    vi.resetAllMocks();
    req = { headers: {} };
    res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis()
    };
    next = vi.fn();
  });

  describe("requireAuth", () => {
    it("should return 401 if no auth header", async () => {
      await requireAuth(req, res, next);
      expect(res.status).toHaveBeenCalledWith(401);
      expect(next).not.toHaveBeenCalled();
    });

    it("should return 401 if invalid format", async () => {
      req.headers.authorization = "Basic token";
      await requireAuth(req, res, next);
      expect(res.status).toHaveBeenCalledWith(401);
    });

    it("should authenticate valid token", async () => {
      req.headers.authorization = "Bearer valid-token";
      vi.mocked(jwt.verify).mockReturnValue({ userId: 1, username: "user1" } as any);
      
      await requireAuth(req, res, next);
      
      expect(req.userId).toBe(1);
      expect(req.username).toBe("user1");
      expect(next).toHaveBeenCalled();
    });

    it("should return 401 if token revoked in Redis", async () => {
      req.headers.authorization = "Bearer revoked-token";
      vi.mocked(jwt.verify).mockReturnValue({ userId: 1, username: "user" } as any);
      vi.mocked(redis.get).mockResolvedValueOnce("true");

      await requireAuth(req, res, next);
      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({ error: "Token revoked" });
    });

    it("should return 401 if token revoked in DB", async () => {
      req.headers.authorization = "Bearer revoked-token";
      vi.mocked(jwt.verify).mockReturnValue({ userId: 1, username: "user" } as any);
      vi.mocked(db.select).mockReturnValue({
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([{ token: "revoked-token" }])
      } as any);

      await requireAuth(req, res, next);
      expect(res.status).toHaveBeenCalledWith(401);
    });

    it("should return 401 if verification fails", async () => {
      req.headers.authorization = "Bearer bad-token";
      vi.mocked(jwt.verify).mockImplementationOnce(() => { throw new Error("Invalid"); });

      await requireAuth(req, res, next);
      expect(res.status).toHaveBeenCalledWith(401);
    });
  });

  describe("optionalAuth", () => {
    it("should call next() if no auth header", async () => {
      await optionalAuth(req, res, next);
      expect(next).toHaveBeenCalled();
      expect(req.userId).toBeUndefined();
    });

    it("should authenticate if valid token provided", async () => {
      req.headers.authorization = "Bearer valid-token";
      vi.mocked(jwt.verify).mockReturnValue({ userId: 1, username: "user1" } as any);
      
      await optionalAuth(req, res, next);
      expect(req.userId).toBe(1);
      expect(next).toHaveBeenCalled();
    });

    it("should call next() even if verification fails (optional)", async () => {
      req.headers.authorization = "Bearer bad-token";
      vi.mocked(jwt.verify).mockImplementationOnce(() => { throw new Error("Invalid"); });

      await optionalAuth(req, res, next);
      expect(next).toHaveBeenCalled();
      expect(req.userId).toBeUndefined();
    });

    it("should return 401 if token explicitly revoked even if optional", async () => {
       req.headers.authorization = "Bearer revoked-token";
       vi.mocked(jwt.verify).mockReturnValue({ userId: 1, username: "user" } as any);
       vi.mocked(redis.get).mockResolvedValueOnce("true");

       await optionalAuth(req, res, next);
       expect(res.status).toHaveBeenCalledWith(401);
    });
  });
});
