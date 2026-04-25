import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";

// ── Mock argon2 ──────────────────────────────────────────────────────────────
vi.mock("argon2", () => ({
  default: {
    hash: vi.fn().mockResolvedValue("$argon2id$hashed"),
    verify: vi.fn().mockResolvedValue(true),
    argon2id: 2,
  },
  hash: vi.fn().mockResolvedValue("$argon2id$hashed"),
  verify: vi.fn().mockResolvedValue(true),
  argon2id: 2,
}));

// ── Mock jsonwebtoken ────────────────────────────────────────────────────────
vi.mock("jsonwebtoken", () => ({
  default: {
    sign: vi.fn().mockReturnValue("mock-access-token"),
    decode: vi.fn().mockReturnValue({ userId: 1, username: "testuser", exp: Math.floor(Date.now() / 1000) + 900 }),
    verify: vi.fn().mockReturnValue({ userId: 1, username: "testuser" }),
  },
  sign: vi.fn().mockReturnValue("mock-access-token"),
  decode: vi.fn().mockReturnValue({ userId: 1, username: "testuser", exp: Math.floor(Date.now() / 1000) + 900 }),
  verify: vi.fn().mockReturnValue({ userId: 1, username: "testuser" }),
}));

// ── Mock crypto ──────────────────────────────────────────────────────────────
vi.mock("crypto", () => {
  const actual = {
    randomBytes: vi.fn().mockReturnValue({ toString: () => "mock-refresh-token-base64url" }),
    createHash: vi.fn().mockReturnValue({
      update: vi.fn().mockReturnValue({
        digest: vi.fn().mockReturnValue("mock-token-hash"),
      }),
    }),
    randomUUID: vi.fn().mockReturnValue("mock-uuid"),
  };
  return { default: actual, ...actual };
});

// ── Mock drizzle db ──────────────────────────────────────────────────────────
const mockLimit = vi.fn();
const mockWhere = vi.fn().mockReturnValue({ limit: mockLimit });
const mockFrom = vi.fn().mockReturnValue({ where: mockWhere });
const mockSelect = vi.fn().mockReturnValue({ from: mockFrom });
const mockReturning = vi.fn();
const mockValues = vi.fn().mockReturnValue({ returning: mockReturning, onConflictDoUpdate: vi.fn().mockResolvedValue(undefined) });
const mockInsert = vi.fn().mockReturnValue({ values: mockValues });
const mockSet = vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) });
const mockUpdate = vi.fn().mockReturnValue({ set: mockSet });
const mockDeleteWhere = vi.fn().mockResolvedValue(undefined);
const mockDelete = vi.fn().mockReturnValue({ where: mockDeleteWhere });

vi.mock("../../src/lib/drizzle.js", () => ({
  db: {
    select: (...args: any[]) => mockSelect(...args),
    insert: (...args: any[]) => mockInsert(...args),
    update: (...args: any[]) => mockUpdate(...args),
    delete: (...args: any[]) => mockDelete(...args),
  },
}));

// ── Mock drizzle-orm ─────────────────────────────────────────────────────────
vi.mock("drizzle-orm", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...(actual as object),
    eq: vi.fn((a: any, b: any) => ({ field: a, value: b })),
    relations: vi.fn(),
  };
});

// ── Mock db schemas ──────────────────────────────────────────────────────────
vi.mock("../../src/db/schema/users.js", () => ({
  users: {
    id: "id",
    username: "username",
    passwordHash: "passwordHash",
    customInstructions: "customInstructions",
    createdAt: "createdAt",
  },
}));

vi.mock("../../src/db/schema/auth.js", () => ({
  refreshTokens: { id: "id", tokenHash: "tokenHash", userId: "userId" },
  revokedTokens: { token: "token" },
  councilConfigs: { userId: "userId", config: "config" },
}));

// ── Mock redis ───────────────────────────────────────────────────────────────
vi.mock("../../src/lib/redis.js", () => ({
  default: {
    set: vi.fn().mockResolvedValue("OK"),
    get: vi.fn().mockResolvedValue(null),
  },
}));

// ── Mock env ─────────────────────────────────────────────────────────────────
vi.mock("../../src/config/env.js", () => ({
  env: {
    JWT_SECRET: "test-jwt-secret-1234567890",
    NODE_ENV: "test",
  },
}));

// ── Mock logger ──────────────────────────────────────────────────────────────
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

// ── Mock fastifyAuth middleware ───────────────────────────────────────────────
vi.mock("../../src/middleware/fastifyAuth.js", () => ({
  fastifyRequireAuth: vi.fn().mockImplementation(async () => {}),
}));

// ── Mock validate middleware ─────────────────────────────────────────────────
vi.mock("../../src/middleware/validate.js", () => ({
  fastifyValidate: vi.fn().mockReturnValue(vi.fn().mockImplementation(async () => {})),
  authSchema: {
    safeParse: vi.fn().mockReturnValue({ success: true, data: { username: "testuser", password: "password123" } }),
  },
  configSchema: {
    safeParse: vi.fn().mockReturnValue({ success: true, data: { config: { members: [], masterIndex: 0 } } }),
  },
  userSettingsSchema: {
    safeParse: vi.fn().mockReturnValue({ success: true, data: { theme: "dark" } }),
  },
}));

// ── Mock lib/crypto (encrypt/decrypt) ────────────────────────────────────────
vi.mock("../../src/lib/crypto.js", () => ({
  encrypt: vi.fn().mockReturnValue("encrypted-config-data"),
  decrypt: vi.fn().mockReturnValue('{"members":[],"masterIndex":0}'),
}));

// ── Mock AppError ────────────────────────────────────────────────────────────
vi.mock("../../src/middleware/errorHandler.js", () => ({
  AppError: class AppError extends Error {
    statusCode: number;
    code: string;
    isOperational: boolean;
    constructor(statusCode: number, message: string, code = "INTERNAL_ERROR", isOperational = true) {
      super(message);
      this.statusCode = statusCode;
      this.code = code;
      this.isOperational = isOperational;
    }
  },
}));

import argon2 from "argon2";
import jwt from "jsonwebtoken";
import redis from "../../src/lib/redis.js";
import { encrypt, decrypt } from "../../src/lib/crypto.js";
import { AppError } from "../../src/middleware/errorHandler.js";
import authPlugin from "../../src/routes/auth.js";

// ── Capture route handlers ───────────────────────────────────────────────────
const routes: Record<string, { handler: Function; opts?: any }> = {};

function captureRoute(method: string) {
  return vi.fn((path: string, optsOrHandler: any, maybeHandler?: any) => {
    const handler = maybeHandler || optsOrHandler;
    const opts = maybeHandler ? optsOrHandler : undefined;
    routes[`${method} ${path}`] = { handler, opts };
  });
}

const mockFastify = {
  get: captureRoute("GET"),
  post: captureRoute("POST"),
  put: captureRoute("PUT"),
  patch: captureRoute("PATCH"),
  delete: captureRoute("DELETE"),
};

// ── Helpers ──────────────────────────────────────────────────────────────────
function createMockReply() {
  const reply: any = {
    statusCode: 200,
    code: vi.fn(function (this: any, c: number) {
      this.statusCode = c;
      return this;
    }),
    send: vi.fn(function (this: any, data: any) {
      return data;
    }),
    setCookie: vi.fn(),
    clearCookie: vi.fn(),
  };
  return reply;
}

function createMockRequest(overrides: any = {}) {
  return {
    body: {},
    headers: {},
    cookies: {},
    userId: undefined as number | undefined,
    username: undefined as string | undefined,
    ...overrides,
  };
}

// ── Register the plugin once ─────────────────────────────────────────────────
beforeAll(async () => {
  await authPlugin(mockFastify as any, {});
});

// ── Reset mocks between tests ────────────────────────────────────────────────
beforeEach(() => {
  vi.clearAllMocks();

  // Re-wire the db mock chain defaults
  mockLimit.mockResolvedValue([]);
  mockWhere.mockReturnValue({ limit: mockLimit });
  mockFrom.mockReturnValue({ where: mockWhere });
  mockSelect.mockReturnValue({ from: mockFrom });
  mockReturning.mockResolvedValue([{ id: 1, username: "testuser" }]);
  mockValues.mockReturnValue({
    returning: mockReturning,
    onConflictDoUpdate: vi.fn().mockResolvedValue(undefined),
  });
  mockInsert.mockReturnValue({ values: mockValues });
  mockSet.mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) });
  mockUpdate.mockReturnValue({ set: mockSet });
  mockDeleteWhere.mockResolvedValue(undefined);
  mockDelete.mockReturnValue({ where: mockDeleteWhere });

  // Re-wire argon2 defaults
  (argon2.hash as any).mockResolvedValue("$argon2id$hashed");
  (argon2.verify as any).mockResolvedValue(true);

  // Re-wire jwt defaults
  (jwt.sign as any).mockReturnValue("mock-access-token");
  (jwt.decode as any).mockReturnValue({ userId: 1, username: "testuser", exp: Math.floor(Date.now() / 1000) + 900 });

  // Re-wire crypto mocks
  (encrypt as any).mockReturnValue("encrypted-config-data");
  (decrypt as any).mockReturnValue('{"members":[],"masterIndex":0}');

  // Re-wire redis
  (redis.set as any).mockResolvedValue("OK");
});

// ═════════════════════════════════════════════════════════════════════════════
// TESTS
// ═════════════════════════════════════════════════════════════════════════════

describe("Auth Routes Plugin", () => {
  it("registers all expected routes", () => {
    expect(routes["POST /register"]).toBeDefined();
    expect(routes["POST /login"]).toBeDefined();
    expect(routes["POST /logout"]).toBeDefined();
    expect(routes["GET /me"]).toBeDefined();
    expect(routes["POST /refresh"]).toBeDefined();
    expect(routes["PATCH /me"]).toBeDefined();
    expect(routes["POST /config"]).toBeDefined();
    expect(routes["GET /config"]).toBeDefined();
    expect(routes["POST /config/rotate"]).toBeDefined();
  });

  // ── POST /register ───────────────────────────────────────────────────────
  describe("POST /register", () => {
    it("registers a new user and returns token pair with 201", async () => {
      const req = createMockRequest({ body: { username: "testuser", password: "password123" } });
      const reply = createMockReply();

      const result = await routes["POST /register"].handler(req, reply);

      expect(argon2.hash).toHaveBeenCalledWith("password123", { type: argon2.argon2id, memoryCost: 65536, timeCost: 3 });
      expect(mockInsert).toHaveBeenCalled();
      expect(reply.code).toHaveBeenCalledWith(201);
      expect(result).toEqual(expect.objectContaining({ token: "mock-access-token", username: "testuser" }));
      expect(reply.setCookie).toHaveBeenCalledWith(
        "refresh_token",
        expect.any(String),
        expect.objectContaining({ httpOnly: true, sameSite: "strict", path: "/api/auth" }),
      );
    });

    it("throws 409 when username is already taken (duplicate key)", async () => {
      mockReturning.mockRejectedValueOnce(Object.assign(new Error("duplicate"), { code: "23505" }));
      // The insert().values().returning() chain throws, so we need the values mock to lead to throwing returning
      mockValues.mockReturnValueOnce({
        returning: mockReturning,
        onConflictDoUpdate: vi.fn(),
      });

      const req = createMockRequest({ body: { username: "testuser", password: "password123" } });
      const reply = createMockReply();

      await expect(routes["POST /register"].handler(req, reply)).rejects.toThrow();
      try {
        await routes["POST /register"].handler(req, reply);
      } catch (e: any) {
        expect(e.statusCode).toBe(409);
        expect(e.message).toBe("Username already taken");
      }
    });

    it("re-throws non-duplicate errors", async () => {
      const genericError = new Error("DB connection lost");
      mockReturning.mockRejectedValueOnce(genericError);
      mockValues.mockReturnValueOnce({
        returning: mockReturning,
        onConflictDoUpdate: vi.fn(),
      });

      const req = createMockRequest({ body: { username: "testuser", password: "password123" } });
      const reply = createMockReply();

      await expect(routes["POST /register"].handler(req, reply)).rejects.toThrow("DB connection lost");
    });
  });

  // ── POST /login ──────────────────────────────────────────────────────────
  describe("POST /login", () => {
    it("logs in a user with valid argon2 password and returns token pair", async () => {
      mockLimit.mockResolvedValueOnce([{ id: 1, username: "testuser", passwordHash: "$argon2id$somehash" }]);

      const req = createMockRequest({ body: { username: "testuser", password: "password123" } });
      const reply = createMockReply();

      const result = await routes["POST /login"].handler(req, reply);

      expect(argon2.verify).toHaveBeenCalledWith("$argon2id$somehash", "password123");
      expect(result).toEqual(expect.objectContaining({ token: "mock-access-token", username: "testuser" }));
      expect(reply.setCookie).toHaveBeenCalled();
    });

    it("throws 401 when user is not found", async () => {
      mockLimit.mockResolvedValueOnce([]);

      const req = createMockRequest({ body: { username: "nouser", password: "password123" } });
      const reply = createMockReply();

      await expect(routes["POST /login"].handler(req, reply)).rejects.toThrow("Invalid username or password");
      mockLimit.mockResolvedValueOnce([]);
      try {
        await routes["POST /login"].handler(req, reply);
      } catch (e: any) {
        expect(e.statusCode).toBe(401);
      }
    });

    it("throws 401 when argon2 password is wrong", async () => {
      mockLimit.mockResolvedValueOnce([{ id: 1, username: "testuser", passwordHash: "$argon2id$somehash" }]);
      (argon2.verify as any).mockResolvedValueOnce(false);

      const req = createMockRequest({ body: { username: "testuser", password: "wrongpass" } });
      const reply = createMockReply();

      await expect(routes["POST /login"].handler(req, reply)).rejects.toThrow("Invalid username or password");
    });

    it("supports bcrypt password migration on successful login", async () => {
      mockLimit.mockResolvedValueOnce([{ id: 1, username: "testuser", passwordHash: "$2b$10$bcrypthash" }]);

      // Mock dynamic import of bcryptjs
      const mockBcrypt = { compare: vi.fn().mockResolvedValue(true) };
      vi.doMock("bcryptjs", () => ({ default: mockBcrypt }));

      const req = createMockRequest({ body: { username: "testuser", password: "password123" } });
      const reply = createMockReply();

      const result = await routes["POST /login"].handler(req, reply);

      // Should have re-hashed with argon2 after successful bcrypt login
      expect(argon2.hash).toHaveBeenCalled();
      expect(mockUpdate).toHaveBeenCalled();
      expect(result).toEqual(expect.objectContaining({ token: "mock-access-token" }));
    });

    it("throws 401 when bcryptjs is not installed for bcrypt hash", async () => {
      mockLimit.mockResolvedValueOnce([{ id: 1, username: "testuser", passwordHash: "$2a$10$bcrypthash" }]);

      // Force dynamic import to fail
      vi.doMock("bcryptjs", () => { throw new Error("Cannot find module"); });

      const req = createMockRequest({ body: { username: "testuser", password: "password123" } });
      const reply = createMockReply();

      await expect(routes["POST /login"].handler(req, reply)).rejects.toThrow("Invalid username or password");
    });

    it("throws 401 when bcrypt password is incorrect", async () => {
      mockLimit.mockResolvedValueOnce([{ id: 1, username: "testuser", passwordHash: "$2b$10$bcrypthash" }]);

      const mockBcrypt = { compare: vi.fn().mockResolvedValue(false) };
      vi.doMock("bcryptjs", () => ({ default: mockBcrypt }));

      const req = createMockRequest({ body: { username: "testuser", password: "wrongpass" } });
      const reply = createMockReply();

      await expect(routes["POST /login"].handler(req, reply)).rejects.toThrow("Invalid username or password");
    });
  });

  // ── POST /logout ─────────────────────────────────────────────────────────
  describe("POST /logout", () => {
    it("revokes access token in redis and DB, revokes refresh token, clears cookie", async () => {
      const req = createMockRequest({
        headers: { authorization: "Bearer mock-jwt-token" },
        cookies: { refresh_token: "mock-refresh-cookie" },
      });
      const reply = createMockReply();

      const result = await routes["POST /logout"].handler(req, reply);

      expect(jwt.decode).toHaveBeenCalledWith("mock-jwt-token");
      expect(redis.set).toHaveBeenCalledWith(
        "revoked:mock-token-hash",
        "1",
        expect.objectContaining({ EX: expect.any(Number) }),
      );
      // Should insert into revokedTokens
      expect(mockInsert).toHaveBeenCalled();
      // Should delete the refresh token
      expect(mockDelete).toHaveBeenCalled();
      // Should clear cookie
      expect(reply.clearCookie).toHaveBeenCalledWith("refresh_token", { path: "/api/auth" });
      expect(result).toEqual({ success: true });
    });

    it("handles logout without authorization header gracefully", async () => {
      const req = createMockRequest({ headers: {}, cookies: {} });
      const reply = createMockReply();

      const result = await routes["POST /logout"].handler(req, reply);

      expect(jwt.decode).not.toHaveBeenCalled();
      expect(redis.set).not.toHaveBeenCalled();
      expect(reply.clearCookie).toHaveBeenCalledWith("refresh_token", { path: "/api/auth" });
      expect(result).toEqual({ success: true });
    });

    it("handles logout without refresh token cookie", async () => {
      const req = createMockRequest({
        headers: { authorization: "Bearer mock-jwt-token" },
        cookies: {},
      });
      const reply = createMockReply();

      const result = await routes["POST /logout"].handler(req, reply);

      expect(redis.set).toHaveBeenCalled();
      expect(mockDelete).not.toHaveBeenCalled();
      expect(result).toEqual({ success: true });
    });
  });

  // ── GET /me ──────────────────────────────────────────────────────────────
  describe("GET /me", () => {
    it("returns user profile for authenticated user", async () => {
      const userRecord = { id: 1, username: "testuser", customInstructions: "Be helpful", createdAt: new Date() };
      mockLimit.mockResolvedValueOnce([userRecord]);

      const req = createMockRequest({ userId: 1 });
      const reply = createMockReply();

      const result = await routes["GET /me"].handler(req, reply);

      expect(mockSelect).toHaveBeenCalled();
      expect(result).toEqual(userRecord);
    });

    it("throws 404 when user is not found", async () => {
      mockLimit.mockResolvedValueOnce([]);

      const req = createMockRequest({ userId: 999 });
      const reply = createMockReply();

      await expect(routes["GET /me"].handler(req, reply)).rejects.toThrow("User not found");
      mockLimit.mockResolvedValueOnce([]);
      try {
        await routes["GET /me"].handler(req, reply);
      } catch (e: any) {
        expect(e.statusCode).toBe(404);
      }
    });
  });

  // ── POST /refresh ────────────────────────────────────────────────────────
  describe("POST /refresh", () => {
    it("rotates the refresh token and issues new token pair", async () => {
      const storedToken = {
        id: "token-uuid",
        userId: 1,
        tokenHash: "mock-token-hash",
        expiresAt: new Date(Date.now() + 86400000), // tomorrow
      };
      // First select: find refresh token
      mockLimit.mockResolvedValueOnce([storedToken]);
      // Second select: find user
      mockLimit.mockResolvedValueOnce([{ id: 1, username: "testuser" }]);

      const req = createMockRequest({ cookies: { refresh_token: "raw-refresh-token" } });
      const reply = createMockReply();

      const result = await routes["POST /refresh"].handler(req, reply);

      // Should delete old refresh token
      expect(mockDelete).toHaveBeenCalled();
      expect(result).toEqual(expect.objectContaining({ token: "mock-access-token", username: "testuser" }));
      expect(reply.setCookie).toHaveBeenCalledWith(
        "refresh_token",
        expect.any(String),
        expect.objectContaining({ httpOnly: true }),
      );
    });

    it("throws 401 when no refresh token cookie is present", async () => {
      const req = createMockRequest({ cookies: {} });
      const reply = createMockReply();

      await expect(routes["POST /refresh"].handler(req, reply)).rejects.toThrow("No refresh token provided");
      try {
        await routes["POST /refresh"].handler(req, reply);
      } catch (e: any) {
        expect(e.statusCode).toBe(401);
      }
    });

    it("throws 401 when refresh token is not found in DB (replay attack)", async () => {
      mockLimit.mockResolvedValueOnce([]);

      const req = createMockRequest({ cookies: { refresh_token: "unknown-token" } });
      const reply = createMockReply();

      await expect(routes["POST /refresh"].handler(req, reply)).rejects.toThrow("Invalid or expired refresh token");
      expect(reply.clearCookie).toHaveBeenCalledWith("refresh_token", { path: "/api/auth" });
    });

    it("throws 401 when refresh token is expired", async () => {
      const expiredToken = {
        id: "token-uuid",
        userId: 1,
        tokenHash: "mock-token-hash",
        expiresAt: new Date(Date.now() - 86400000), // yesterday
      };
      mockLimit.mockResolvedValueOnce([expiredToken]);

      const req = createMockRequest({ cookies: { refresh_token: "expired-token" } });
      const reply = createMockReply();

      await expect(routes["POST /refresh"].handler(req, reply)).rejects.toThrow("Invalid or expired refresh token");
      expect(reply.clearCookie).toHaveBeenCalledWith("refresh_token", { path: "/api/auth" });
    });
  });

  // ── PATCH /me ────────────────────────────────────────────────────────────
  describe("PATCH /me", () => {
    it("updates custom instructions successfully", async () => {
      const req = createMockRequest({ userId: 1, body: { custom_instructions: "Be concise" } });
      const reply = createMockReply();

      const result = await routes["PATCH /me"].handler(req, reply);

      expect(mockUpdate).toHaveBeenCalled();
      expect(result).toEqual({ success: true });
    });

    it("throws 400 when custom_instructions is not a string", async () => {
      const req = createMockRequest({ userId: 1, body: { custom_instructions: 123 } });
      const reply = createMockReply();

      await expect(routes["PATCH /me"].handler(req, reply)).rejects.toThrow("custom_instructions must be a string");
      try {
        await routes["PATCH /me"].handler(req, reply);
      } catch (e: any) {
        expect(e.statusCode).toBe(400);
      }
    });

    it("truncates custom_instructions to 2000 characters", async () => {
      const longText = "a".repeat(3000);
      const req = createMockRequest({ userId: 1, body: { custom_instructions: longText } });
      const reply = createMockReply();

      await routes["PATCH /me"].handler(req, reply);

      expect(mockSet).toHaveBeenCalledWith(
        expect.objectContaining({ customInstructions: "a".repeat(2000) }),
      );
    });

    it("throws 400 when custom_instructions is missing (undefined)", async () => {
      const req = createMockRequest({ userId: 1, body: {} });
      const reply = createMockReply();

      await expect(routes["PATCH /me"].handler(req, reply)).rejects.toThrow("custom_instructions must be a string");
    });
  });

  // ── POST /config ─────────────────────────────────────────────────────────
  describe("POST /config", () => {
    it("saves council config with encryption", async () => {
      const configData = { members: [{ provider: "openai" }], masterIndex: 0 };
      const req = createMockRequest({ userId: 1, body: { config: configData } });
      const reply = createMockReply();

      const result = await routes["POST /config"].handler(req, reply);

      expect(encrypt).toHaveBeenCalledWith(JSON.stringify(configData));
      expect(mockInsert).toHaveBeenCalled();
      expect(result).toEqual({ success: true });
    });

    it("uses upsert (onConflictDoUpdate) for existing configs", async () => {
      const configData = { members: [], masterIndex: 0 };
      const req = createMockRequest({ userId: 1, body: { config: configData } });
      const reply = createMockReply();

      const mockOnConflict = vi.fn().mockResolvedValue(undefined);
      mockValues.mockReturnValueOnce({
        returning: mockReturning,
        onConflictDoUpdate: mockOnConflict,
      });

      await routes["POST /config"].handler(req, reply);

      expect(mockOnConflict).toHaveBeenCalledWith(
        expect.objectContaining({ target: "userId" }),
      );
    });
  });

  // ── GET /config ──────────────────────────────────────────────────────────
  describe("GET /config", () => {
    it("returns decrypted council config", async () => {
      mockLimit.mockResolvedValueOnce([{ userId: 1, config: "encrypted-config-data" }]);
      (decrypt as any).mockReturnValueOnce('{"members":[{"provider":"openai"}],"masterIndex":0}');

      const req = createMockRequest({ userId: 1 });
      const reply = createMockReply();

      const result = await routes["GET /config"].handler(req, reply);

      expect(decrypt).toHaveBeenCalledWith("encrypted-config-data");
      expect(result).toEqual({ members: [{ provider: "openai" }], masterIndex: 0 });
    });

    it("returns null when no config exists", async () => {
      mockLimit.mockResolvedValueOnce([]);

      const req = createMockRequest({ userId: 1 });
      const reply = createMockReply();

      const result = await routes["GET /config"].handler(req, reply);

      expect(decrypt).not.toHaveBeenCalled();
      expect(result).toBeNull();
    });
  });

  // ── POST /config/rotate ──────────────────────────────────────────────────
  describe("POST /config/rotate", () => {
    it("rotates encryption on existing config", async () => {
      mockLimit.mockResolvedValueOnce([{ userId: 1, config: "old-encrypted" }]);
      (decrypt as any).mockReturnValueOnce('{"members":[],"masterIndex":0}');
      (encrypt as any).mockReturnValueOnce("new-encrypted");

      const req = createMockRequest({ userId: 1 });
      const reply = createMockReply();

      const result = await routes["POST /config/rotate"].handler(req, reply);

      expect(decrypt).toHaveBeenCalledWith("old-encrypted");
      expect(encrypt).toHaveBeenCalledWith('{"members":[],"masterIndex":0}');
      expect(mockUpdate).toHaveBeenCalled();
      expect(result).toEqual({ success: true, message: "Keys rotated successfully" });
    });

    it("throws 404 when no config exists to rotate", async () => {
      mockLimit.mockResolvedValueOnce([]);

      const req = createMockRequest({ userId: 1 });
      const reply = createMockReply();

      await expect(routes["POST /config/rotate"].handler(req, reply)).rejects.toThrow("No configuration found to rotate");
      mockLimit.mockResolvedValueOnce([]);
      try {
        await routes["POST /config/rotate"].handler(req, reply);
      } catch (e: any) {
        expect(e.statusCode).toBe(404);
      }
    });
  });
});
