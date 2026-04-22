/**
 * Integration test: Sandbox routes via fastify.inject()
 *
 * Tests code execution endpoint with auth, validation, and rate limiting.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { buildTestApp, createAuthHeaders } from "../helpers/testApp.js";

vi.mock("../../src/lib/redis.js", () => ({
  default: {
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue("OK"),
    pipeline: vi.fn(() => ({
      get: vi.fn().mockReturnThis(),
      exec: vi.fn().mockResolvedValue([[null, null], [null, null]]),
    })),
  },
}));

vi.mock("../../src/db/schema/auth.js", () => ({
  revokedTokens: { tokenHash: "revokedTokens.tokenHash" },
  refreshTokens: {},
  councilConfigs: {},
}));

vi.mock("../../src/db/schema/users.js", () => ({
  users: { id: "users.id", role: "users.role" },
  dailyUsage: {},
  userSettings: {},
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((...args: any[]) => args),
  and: vi.fn((...args: any[]) => args),
  sql: Object.assign(vi.fn(), { raw: vi.fn() }),
}));

vi.mock("../../src/lib/logger.js", () => ({
  default: {
    info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), child: vi.fn().mockReturnThis(),
  },
}));

vi.mock("../../src/middleware/errorHandler.js", () => ({
  AppError: class AppError extends Error {
    statusCode: number;
    code: string;
    constructor(statusCode: number, message: string, code: string = "INTERNAL_ERROR") {
      super(message);
      this.statusCode = statusCode;
      this.code = code;
    }
  },
}));

vi.mock("../../src/sandbox/jsSandbox.js", () => ({
  executeJS: vi.fn().mockResolvedValue({ output: "hello world\n", error: null, elapsedMs: 12 }),
}));

vi.mock("../../src/sandbox/pythonSandbox.js", () => ({
  executePython: vi.fn().mockResolvedValue({ output: "42\n", error: null, elapsedMs: 55 }),
}));

describe("Sandbox routes integration", () => {
  let app: Awaited<ReturnType<typeof buildTestApp>>;

  beforeAll(async () => {
    const { default: sandboxPlugin } = await import("../../src/routes/sandbox.js");
    app = await buildTestApp([{ plugin: sandboxPlugin, prefix: "/api/sandbox" }]);
  }, 30000);

  afterAll(async () => {
    await app.close();
  });

  describe("POST /api/sandbox/execute", () => {
    it("returns 401 without auth", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/sandbox/execute",
        payload: { language: "javascript", code: "console.log('hi')" },
      });
      expect(res.statusCode).toBe(401);
    });

    it("executes JavaScript code with valid auth", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/sandbox/execute",
        headers: createAuthHeaders(),
        payload: { language: "javascript", code: "console.log('hello world')" },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toHaveProperty("output");
      expect(body).toHaveProperty("elapsed_ms");
    });

    it("executes TypeScript code (treated as JS)", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/sandbox/execute",
        headers: createAuthHeaders(),
        payload: { language: "typescript", code: "const x: number = 1" },
      });
      expect(res.statusCode).toBe(200);
    });

    it("executes Python code", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/sandbox/execute",
        headers: createAuthHeaders(),
        payload: { language: "python", code: "print(42)" },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.output).toBe("42\n");
    });

    it("rejects missing language field", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/sandbox/execute",
        headers: createAuthHeaders(),
        payload: { code: "console.log('hi')" },
      });
      expect(res.statusCode).toBe(400);
    });

    it("rejects missing code field", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/sandbox/execute",
        headers: createAuthHeaders(),
        payload: { language: "javascript" },
      });
      expect(res.statusCode).toBe(400);
    });

    it("rejects unsupported language", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/sandbox/execute",
        headers: createAuthHeaders(),
        payload: { language: "ruby", code: "puts 'hi'" },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().message).toMatch(/Unsupported language/);
    });
  });
});
