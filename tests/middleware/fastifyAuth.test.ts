import { describe, it, expect, vi, beforeEach } from "vitest";
import jwt from "jsonwebtoken";
import { fastifyOptionalAuth, fastifyRequireAuth } from "../../src/middleware/fastifyAuth.js";

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
          limit: vi.fn().mockResolvedValue([]),
        })),
      })),
    })),
  },
}));

const mockPipelineExec = vi.fn().mockResolvedValue([[null, null], [null, null]]);
const mockPipelineGet = vi.fn().mockReturnThis();
const mockPipeline = vi.fn(() => ({ get: mockPipelineGet, exec: mockPipelineExec }));

vi.mock("../../src/lib/redis.js", () => ({
  default: {
    get: vi.fn().mockResolvedValue(null),
    pipeline: () => mockPipeline(),
  },
  get: vi.fn().mockResolvedValue(null),
  pipeline: () => mockPipeline(),
}));

vi.mock("../../src/config/env.js", () => ({
  env: { JWT_SECRET: "test-secret-1234567890" },
}));

vi.mock("../../src/lib/logger.js", () => {
  const childLogger: any = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
  childLogger.child = vi.fn(() => childLogger);
  return {
    default: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
      child: vi.fn(() => childLogger),
    },
  };
});

vi.mock("../../src/db/schema/auth.js", () => ({
  revokedTokens: {
    token: "token",
  },
}));

vi.mock("drizzle-orm", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...(actual as object),
    eq: vi.fn((...args: any[]) => args),
    relations: vi.fn(),
  };
});

function createFastifyRequest(headers: Record<string, string> = {}): any {
  return {
    headers,
    url: "/test",
    userId: undefined,
    username: undefined,
  };
}

function createFastifyReply(): any {
  const reply: any = {
    statusCode: 200,
    body: null,
    code: vi.fn(function (this: any, c: number) {
      this.statusCode = c;
      return this;
    }),
    send: vi.fn(function (this: any, b: any) {
      this.body = b;
      return this;
    }),
  };
  return reply;
}

describe("fastifyOptionalAuth", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does nothing without an authorization header", async () => {
    const request = createFastifyRequest();
    const reply = createFastifyReply();

    await fastifyOptionalAuth(request, reply);

    expect(request.userId).toBeUndefined();
    expect(request.username).toBeUndefined();
    expect(reply.code).not.toHaveBeenCalled();
  });

  it("does nothing with a non-Bearer authorization header", async () => {
    const request = createFastifyRequest({ authorization: "Basic abc123" });
    const reply = createFastifyReply();

    await fastifyOptionalAuth(request, reply);

    expect(request.userId).toBeUndefined();
    expect(request.username).toBeUndefined();
  });

  it("sets userId and username with a valid token", async () => {
    const mockPayload = { userId: 42, username: "testuser", role: "member" };
    vi.mocked(jwt.verify).mockReturnValue(mockPayload as any);

    const request = createFastifyRequest({ authorization: "Bearer valid-token" });
    const reply = createFastifyReply();

    await fastifyOptionalAuth(request, reply);

    expect(request.userId).toBe(42);
    expect(request.username).toBe("testuser");
  });

  it("ignores invalid tokens silently", async () => {
    vi.mocked(jwt.verify).mockImplementation(() => {
      throw new Error("invalid token");
    });

    const request = createFastifyRequest({ authorization: "Bearer bad-token" });
    const reply = createFastifyReply();

    await fastifyOptionalAuth(request, reply);

    expect(request.userId).toBeUndefined();
    expect(request.username).toBeUndefined();
    expect(reply.code).not.toHaveBeenCalled();
  });

  it("ignores revoked tokens", async () => {
    const mockPayload = { userId: 42, username: "testuser", role: "member" };
    vi.mocked(jwt.verify).mockReturnValue(mockPayload as any);

    const redis = await import("../../src/lib/redis.js");
    vi.mocked((redis.default as any).get).mockResolvedValueOnce("true");

    const request = createFastifyRequest({ authorization: "Bearer revoked-token" });
    const reply = createFastifyReply();

    await fastifyOptionalAuth(request, reply);

    expect(request.userId).toBeUndefined();
    expect(request.username).toBeUndefined();
  });
});

describe("fastifyRequireAuth", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 without an authorization header", async () => {
    const request = createFastifyRequest();
    const reply = createFastifyReply();

    await fastifyRequireAuth(request, reply);

    expect(reply.code).toHaveBeenCalledWith(401);
    expect(reply.send).toHaveBeenCalledWith({ error: "Authentication required" });
  });

  it("returns 401 for an invalid token", async () => {
    vi.mocked(jwt.verify).mockImplementation(() => {
      throw new Error("jwt malformed");
    });

    const request = createFastifyRequest({ authorization: "Bearer invalid-token" });
    const reply = createFastifyReply();

    await fastifyRequireAuth(request, reply);

    expect(reply.code).toHaveBeenCalledWith(401);
    expect(reply.send).toHaveBeenCalledWith({ error: "Invalid or expired token" });
  });

  it("returns 401 for a revoked token", async () => {
    const mockPayload = { userId: 42, username: "testuser", role: "member" };
    vi.mocked(jwt.verify).mockReturnValue(mockPayload as any);

    // Pipeline returns: [revokedResult, statusResult] — revoked is truthy
    mockPipelineExec.mockResolvedValueOnce([[null, "true"], [null, null]]);

    const request = createFastifyRequest({ authorization: "Bearer revoked-token" });
    const reply = createFastifyReply();

    await fastifyRequireAuth(request, reply);

    expect(reply.code).toHaveBeenCalledWith(401);
    expect(reply.send).toHaveBeenCalledWith({ error: "Token revoked" });
  });

  it("sets userId and username for a valid token", async () => {
    const mockPayload = { userId: 99, username: "admin", role: "admin" };
    vi.mocked(jwt.verify).mockReturnValue(mockPayload as any);

    // Pipeline returns: both null (not revoked, not suspended)
    mockPipelineExec.mockResolvedValueOnce([[null, null], [null, null]]);

    const request = createFastifyRequest({ authorization: "Bearer good-token" });
    const reply = createFastifyReply();

    await fastifyRequireAuth(request, reply);

    expect(request.userId).toBe(99);
    expect(request.username).toBe("admin");
    expect(reply.code).not.toHaveBeenCalled();
  });

  it("returns 403 for a suspended user", async () => {
    const mockPayload = { userId: 42, username: "suspended-user", role: "member" };
    vi.mocked(jwt.verify).mockReturnValue(mockPayload as any);

    // Pipeline returns: not revoked, but suspended
    mockPipelineExec.mockResolvedValueOnce([[null, null], [null, "suspended"]]);

    const request = createFastifyRequest({ authorization: "Bearer valid-token" });
    const reply = createFastifyReply();

    await fastifyRequireAuth(request, reply);

    expect(reply.code).toHaveBeenCalledWith(403);
    expect(reply.send).toHaveBeenCalledWith({ error: "Account suspended" });
  });
});
