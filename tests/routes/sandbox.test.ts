import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";

// ── Mock logger ──────────────────────────────────────────────────────────────
vi.mock("../../src/lib/logger.js", () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// ── Mock fastifyAuth middleware ───────────────────────────────────────────────
vi.mock("../../src/middleware/fastifyAuth.js", () => ({
  fastifyRequireAuth: vi.fn().mockImplementation(async () => {}),
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

// ── Mock redis (needed by sandboxRateLimiter) ──────────────────────────────
const mockRedisIncr = vi.fn().mockRejectedValue(new Error("no redis"));
const mockRedisExpire = vi.fn().mockResolvedValue(1);
vi.mock("../../src/lib/redis.js", () => ({
  default: {
    incr: (...args: any[]) => mockRedisIncr(...args),
    expire: (...args: any[]) => mockRedisExpire(...args),
    get: vi.fn().mockResolvedValue(null),
  },
}));

// ── Mock sandbox executors ───────────────────────────────────────────────────
const mockExecuteJS = vi.fn();
const mockExecutePython = vi.fn();

vi.mock("../../src/sandbox/jsSandbox.js", () => ({
  executeJS: (...args: any[]) => mockExecuteJS(...args),
}));

vi.mock("../../src/sandbox/pythonSandbox.js", () => ({
  executePython: (...args: any[]) => mockExecutePython(...args),
}));

import { AppError } from "../../src/middleware/errorHandler.js";
import sandboxPlugin from "../../src/routes/sandbox.js";

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
  };
  return reply;
}

function createMockRequest(overrides: any = {}) {
  return {
    body: {},
    headers: {},
    ip: "127.0.0.1",
    userId: 1,
    username: "testuser",
    ...overrides,
  };
}

// ── Register the plugin once ─────────────────────────────────────────────────
beforeAll(async () => {
  await sandboxPlugin(mockFastify as any, {});
});

// ── Reset mocks between tests ────────────────────────────────────────────────
beforeEach(() => {
  vi.clearAllMocks();
});

// ── Tests ────────────────────────────────────────────────────────────────────
describe("sandbox routes", () => {
  describe("route registration", () => {
    it("registers POST /execute", () => {
      expect(routes["POST /execute"]).toBeDefined();
      expect(routes["POST /execute"].handler).toBeTypeOf("function");
    });

    it("sets preHandler with fastifyRequireAuth and sandboxRateLimiter", () => {
      const opts = routes["POST /execute"].opts;
      expect(opts).toBeDefined();
      expect(opts.preHandler).toBeDefined();
      expect(opts.preHandler).toHaveLength(2);
    });
  });

  describe("POST /execute – validation", () => {
    it("throws 400 when language is missing", async () => {
      const handler = routes["POST /execute"].handler;
      const request = createMockRequest({ body: { code: "console.log(1)" } });
      const reply = createMockReply();

      await expect(handler(request, reply)).rejects.toThrow(AppError);
      await expect(handler(request, reply)).rejects.toMatchObject({
        statusCode: 400,
        code: "SANDBOX_MISSING_FIELDS",
      });
    });

    it("throws 400 when code is missing", async () => {
      const handler = routes["POST /execute"].handler;
      const request = createMockRequest({ body: { language: "javascript" } });
      const reply = createMockReply();

      await expect(handler(request, reply)).rejects.toThrow(AppError);
      await expect(handler(request, reply)).rejects.toMatchObject({
        statusCode: 400,
        code: "SANDBOX_MISSING_FIELDS",
      });
    });

    it("throws 400 when both language and code are missing", async () => {
      const handler = routes["POST /execute"].handler;
      const request = createMockRequest({ body: {} });
      const reply = createMockReply();

      await expect(handler(request, reply)).rejects.toThrow(AppError);
      await expect(handler(request, reply)).rejects.toMatchObject({
        statusCode: 400,
        code: "SANDBOX_MISSING_FIELDS",
      });
    });

    it("throws 400 for unsupported language", async () => {
      const handler = routes["POST /execute"].handler;
      const request = createMockRequest({
        body: { language: "ruby", code: "puts 'hello'" },
      });
      const reply = createMockReply();

      await expect(handler(request, reply)).rejects.toThrow(AppError);
      await expect(handler(request, reply)).rejects.toMatchObject({
        statusCode: 400,
        code: "SANDBOX_UNSUPPORTED_LANG",
      });
    });

    it("throws 400 when code exceeds 50,000 characters", async () => {
      const handler = routes["POST /execute"].handler;
      const request = createMockRequest({
        body: { language: "javascript", code: "x".repeat(50_001) },
      });
      const reply = createMockReply();

      await expect(handler(request, reply)).rejects.toThrow(AppError);
      await expect(handler(request, reply)).rejects.toMatchObject({
        statusCode: 400,
        code: "SANDBOX_CODE_TOO_LONG",
      });
    });

    it("accepts code exactly at 50,000 characters", async () => {
      const handler = routes["POST /execute"].handler;
      mockExecuteJS.mockResolvedValue({ output: "done", error: null, elapsedMs: 10 });
      const request = createMockRequest({
        body: { language: "javascript", code: "x".repeat(50_000) },
      });
      const reply = createMockReply();

      const result = await handler(request, reply);
      expect(result).toEqual({ output: "done", error: null, elapsed_ms: 10 });
    });
  });

  describe("POST /execute – JavaScript execution", () => {
    it("executes JavaScript code and returns result", async () => {
      const handler = routes["POST /execute"].handler;
      mockExecuteJS.mockResolvedValue({ output: "hello world\n", error: null, elapsedMs: 42 });

      const request = createMockRequest({
        body: { language: "javascript", code: 'console.log("hello world")' },
      });
      const reply = createMockReply();

      const result = await handler(request, reply);

      expect(mockExecuteJS).toHaveBeenCalledWith('console.log("hello world")', 5000);
      expect(result).toEqual({
        output: "hello world\n",
        error: null,
        elapsed_ms: 42,
      });
    });

    it("returns execution errors from the sandbox in the result", async () => {
      const handler = routes["POST /execute"].handler;
      mockExecuteJS.mockResolvedValue({
        output: "",
        error: "ReferenceError: x is not defined",
        elapsedMs: 5,
      });

      const request = createMockRequest({
        body: { language: "javascript", code: "console.log(x)" },
      });
      const reply = createMockReply();

      const result = await handler(request, reply);

      expect(result).toEqual({
        output: "",
        error: "ReferenceError: x is not defined",
        elapsed_ms: 5,
      });
    });
  });

  describe("POST /execute – TypeScript execution", () => {
    it("executes TypeScript via executeJS (same as JavaScript)", async () => {
      const handler = routes["POST /execute"].handler;
      mockExecuteJS.mockResolvedValue({ output: "typed\n", error: null, elapsedMs: 30 });

      const request = createMockRequest({
        body: { language: "typescript", code: "const x: number = 1; console.log(x)" },
      });
      const reply = createMockReply();

      const result = await handler(request, reply);

      expect(mockExecuteJS).toHaveBeenCalledWith("const x: number = 1; console.log(x)", 5000);
      expect(mockExecutePython).not.toHaveBeenCalled();
      expect(result).toEqual({
        output: "typed\n",
        error: null,
        elapsed_ms: 30,
      });
    });
  });

  describe("POST /execute – Python execution", () => {
    it("executes Python code with 10s timeout and returns result", async () => {
      const handler = routes["POST /execute"].handler;
      mockExecutePython.mockResolvedValue({ output: "3.14\n", error: null, elapsedMs: 150 });

      const request = createMockRequest({
        body: { language: "python", code: "print(3.14)" },
      });
      const reply = createMockReply();

      const result = await handler(request, reply);

      expect(mockExecutePython).toHaveBeenCalledWith("print(3.14)", 10000);
      expect(mockExecuteJS).not.toHaveBeenCalled();
      expect(result).toEqual({
        output: "3.14\n",
        error: null,
        elapsed_ms: 150,
      });
    });
  });

  describe("POST /execute – error handling", () => {
    it("re-throws AppError from executor as-is", async () => {
      const handler = routes["POST /execute"].handler;
      const appErr = new AppError(400, "bad input", "SANDBOX_UNSUPPORTED_LANG");
      mockExecuteJS.mockRejectedValue(appErr);

      const request = createMockRequest({
        body: { language: "javascript", code: "bad" },
      });
      const reply = createMockReply();

      await expect(handler(request, reply)).rejects.toBe(appErr);
    });

    it("wraps non-AppError executor errors as 500 SANDBOX_EXEC_FAILED", async () => {
      const handler = routes["POST /execute"].handler;
      mockExecuteJS.mockRejectedValue(new Error("Sandbox process crashed"));

      const request = createMockRequest({
        body: { language: "javascript", code: "crash()" },
      });
      const reply = createMockReply();

      await expect(handler(request, reply)).rejects.toThrow(AppError);
      await expect(handler(request, reply)).rejects.toMatchObject({
        statusCode: 500,
        code: "SANDBOX_EXEC_FAILED",
      });
    });

    it("includes the original error message in the wrapped error", async () => {
      const handler = routes["POST /execute"].handler;
      mockExecuteJS.mockRejectedValue(new Error("OOM killed"));

      const request = createMockRequest({
        body: { language: "javascript", code: "Array(1e9)" },
      });
      const reply = createMockReply();

      try {
        await handler(request, reply);
        expect.unreachable("should have thrown");
      } catch (err: any) {
        expect(err.message).toContain("OOM killed");
        expect(err.message).toContain("Execution failed");
      }
    });

    it("wraps Python executor errors as 500 SANDBOX_EXEC_FAILED", async () => {
      const handler = routes["POST /execute"].handler;
      mockExecutePython.mockRejectedValue(new Error("Python not found"));

      const request = createMockRequest({
        body: { language: "python", code: "import os" },
      });
      const reply = createMockReply();

      await expect(handler(request, reply)).rejects.toThrow(AppError);
      await expect(handler(request, reply)).rejects.toMatchObject({
        statusCode: 500,
        code: "SANDBOX_EXEC_FAILED",
      });
    });
  });

  describe("sandboxRateLimiter (preHandler)", () => {
    it("is attached as the second preHandler", () => {
      const opts = routes["POST /execute"].opts;
      expect(opts.preHandler).toHaveLength(2);
      // First is fastifyRequireAuth, second is sandboxRateLimiter
      expect(typeof opts.preHandler[1]).toBe("function");
    });

    it("allows requests under the rate limit", async () => {
      const rateLimiter = routes["POST /execute"].opts.preHandler[1];
      const request = createMockRequest({ userId: 999, ip: "10.0.0.1" });
      const reply = createMockReply();

      await rateLimiter(request, reply);

      expect(reply.code).not.toHaveBeenCalled();
    });

    it("blocks the 11th request within a minute window", async () => {
      const rateLimiter = routes["POST /execute"].opts.preHandler[1];
      const request = createMockRequest({ userId: 8888, ip: "10.0.0.88" });
      const reply = createMockReply();

      // Fire 10 requests (should all pass)
      for (let i = 0; i < 10; i++) {
        await rateLimiter(request, createMockReply());
      }

      // 11th request should be blocked
      await rateLimiter(request, reply);

      expect(reply.code).toHaveBeenCalledWith(429);
      expect(reply.send).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.stringContaining("Too many sandbox executions"),
          code: "SANDBOX_RATE_LIMIT",
        })
      );
    });

    it("uses userId for the rate limit key when present", async () => {
      const rateLimiter = routes["POST /execute"].opts.preHandler[1];
      // Two requests from different IPs but same userId should share the bucket
      const request1 = createMockRequest({ userId: 7777, ip: "1.1.1.1" });
      const request2 = createMockRequest({ userId: 7777, ip: "2.2.2.2" });
      const reply = createMockReply();

      // Burn through 10 from request1
      for (let i = 0; i < 10; i++) {
        await rateLimiter(request1, createMockReply());
      }

      // request2 with same userId should be blocked
      await rateLimiter(request2, reply);
      expect(reply.code).toHaveBeenCalledWith(429);
    });

    it("falls back to IP when userId is not set", async () => {
      const rateLimiter = routes["POST /execute"].opts.preHandler[1];
      const request = createMockRequest({ userId: undefined, ip: "192.168.0.42" });
      const reply = createMockReply();

      await rateLimiter(request, reply);

      expect(reply.code).not.toHaveBeenCalled();
    });
  });

  describe("POST /execute – allowed languages", () => {
    it.each(["javascript", "typescript", "python"])("accepts %s as a valid language", async (lang) => {
      const handler = routes["POST /execute"].handler;
      const mockResult = { output: "ok", error: null, elapsedMs: 1 };

      if (lang === "python") {
        mockExecutePython.mockResolvedValue(mockResult);
      } else {
        mockExecuteJS.mockResolvedValue(mockResult);
      }

      const request = createMockRequest({ body: { language: lang, code: "x" } });
      const reply = createMockReply();

      const result = await handler(request, reply);
      expect(result).toEqual({ output: "ok", error: null, elapsed_ms: 1 });
    });

    it.each(["ruby", "java", "go", "rust", "c", "cpp", ""])(
      "rejects %s as an unsupported language",
      async (lang) => {
        const handler = routes["POST /execute"].handler;
        const request = createMockRequest({ body: { language: lang, code: "x" } });
        const reply = createMockReply();

        // empty string hits missing-fields check, others hit unsupported-lang
        await expect(handler(request, reply)).rejects.toThrow(AppError);
      }
    );
  });
});
