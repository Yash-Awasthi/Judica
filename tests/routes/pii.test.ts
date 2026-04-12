import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/lib/pii.js", () => ({
  detectPII: vi.fn(),
}));

vi.mock("../../src/lib/logger.js", () => ({
  default: {
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
}));

vi.mock("../../src/middleware/fastifyAuth.js", () => ({
  fastifyRequireAuth: vi.fn((_req: unknown, _reply: unknown, done: () => void) => done()),
}));

vi.mock("../../src/middleware/errorHandler.js", () => ({
  AppError: class AppError extends Error {
    constructor(
      public statusCode: number,
      public override message: string,
      public code: string = "INTERNAL_ERROR",
    ) {
      super(message);
    }
  },
}));

import { detectPII } from "../../src/lib/pii.js";
import logger from "../../src/lib/logger.js";
import piiPlugin from "../../src/routes/pii.js";

const mockedDetectPII = vi.mocked(detectPII);

type RouteHandler = (request: unknown, reply: unknown) => Promise<unknown>;

function buildMockFastify() {
  const routes: Record<string, { handler: RouteHandler; opts: unknown }> = {};
  const fastify = {
    post: vi.fn((path: string, opts: unknown, handler: RouteHandler) => {
      routes[`POST ${path}`] = { handler, opts };
    }),
    get: vi.fn((path: string, opts: unknown, handler: RouteHandler) => {
      routes[`GET ${path}`] = { handler, opts };
    }),
  };
  return { fastify, routes };
}

function buildRequest(body: unknown, userId?: string) {
  return { body, userId: userId ?? "user-123" };
}

function buildReply() {
  const reply = {
    statusCode: 200,
    code: vi.fn((c: number) => {
      reply.statusCode = c;
      return reply;
    }),
  };
  return reply;
}

function makePIIDetectionResult(overrides: Partial<ReturnType<typeof detectPII>> = {}) {
  return {
    found: false,
    types: [] as string[],
    matches: [],
    anonymized: "",
    riskScore: 0,
    recommendations: [],
    ...overrides,
  };
}

describe("pii route plugin", () => {
  let routes: Record<string, { handler: RouteHandler; opts: unknown }>;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mock = buildMockFastify();
    routes = mock.routes;
    await piiPlugin(mock.fastify as never, {});
  });

  it("should register POST /check route", () => {
    expect(routes["POST /check"]).toBeDefined();
  });

  // ---------- Validation ----------

  it("should return 400 when text is missing", async () => {
    const reply = buildReply();
    const result = await routes["POST /check"].handler(buildRequest({}), reply);
    expect(reply.code).toHaveBeenCalledWith(400);
    expect(result).toEqual({ error: "Text is required" });
  });

  it("should return 400 when text is null", async () => {
    const reply = buildReply();
    const result = await routes["POST /check"].handler(buildRequest({ text: null }), reply);
    expect(reply.code).toHaveBeenCalledWith(400);
    expect(result).toEqual({ error: "Text is required" });
  });

  it("should return 400 when text is empty string", async () => {
    const reply = buildReply();
    const result = await routes["POST /check"].handler(buildRequest({ text: "" }), reply);
    expect(reply.code).toHaveBeenCalledWith(400);
    expect(result).toEqual({ error: "Text is required" });
  });

  it("should return 400 when text is a number instead of string", async () => {
    const reply = buildReply();
    const result = await routes["POST /check"].handler(buildRequest({ text: 42 }), reply);
    expect(reply.code).toHaveBeenCalledWith(400);
    expect(result).toEqual({ error: "Text is required" });
  });

  // ---------- No PII found ----------

  it("should return found=false for clean text", async () => {
    mockedDetectPII.mockReturnValue(makePIIDetectionResult({
      found: false,
      anonymized: "clean text",
    }));

    const reply = buildReply();
    const result = await routes["POST /check"].handler(
      buildRequest({ text: "clean text" }),
      reply,
    ) as Record<string, unknown>;

    expect(result.found).toBe(false);
    expect(result.types).toEqual([]);
    expect(result.riskScore).toBe(0);
    expect(result.anonymized).toBe("clean text");
    expect(result.allowed).toBe(true);
    expect(result.message).toBeUndefined();
  });

  // ---------- PII found, enforce=false (default) ----------

  it("should return found=true and allowed=true when PII found but enforce is false", async () => {
    mockedDetectPII.mockReturnValue(makePIIDetectionResult({
      found: true,
      types: ["email"],
      riskScore: 5,
      anonymized: "Contact [EMAIL_REDACTED]",
    }));

    const reply = buildReply();
    const result = await routes["POST /check"].handler(
      buildRequest({ text: "Contact test@example.com" }),
      reply,
    ) as Record<string, unknown>;

    expect(result.found).toBe(true);
    expect(result.types).toEqual(["email"]);
    // riskScore = base(5) + email weight(30) = 35
    expect(result.riskScore).toBe(35);
    expect(result.allowed).toBe(true);
    expect(result.message).toBe("PII detected: email. Risk score: 35");
  });

  // ---------- Risk score calculations ----------

  it("should calculate risk score using known type weights", async () => {
    mockedDetectPII.mockReturnValue(makePIIDetectionResult({
      found: true,
      types: ["ssn", "creditCard"],
      riskScore: 20,
      anonymized: "[REDACTED]",
    }));

    const reply = buildReply();
    const result = await routes["POST /check"].handler(
      buildRequest({ text: "ssn and cc" }),
      reply,
    ) as Record<string, unknown>;

    // riskScore = base(20) + ssn(100) + creditCard(90) = 210
    expect(result.riskScore).toBe(210);
  });

  it("should use default weight of 10 for unknown PII types", async () => {
    mockedDetectPII.mockReturnValue(makePIIDetectionResult({
      found: true,
      types: ["unknown_type"],
      riskScore: 0,
      anonymized: "[REDACTED]",
    }));

    const reply = buildReply();
    const result = await routes["POST /check"].handler(
      buildRequest({ text: "some text" }),
      reply,
    ) as Record<string, unknown>;

    // riskScore = base(0) + unknown fallback(10) = 10
    expect(result.riskScore).toBe(10);
  });

  it("should sum weights for multiple PII types", async () => {
    mockedDetectPII.mockReturnValue(makePIIDetectionResult({
      found: true,
      types: ["email", "phone", "ipAddress"],
      riskScore: 10,
      anonymized: "[REDACTED]",
    }));

    const reply = buildReply();
    const result = await routes["POST /check"].handler(
      buildRequest({ text: "pii text" }),
      reply,
    ) as Record<string, unknown>;

    // riskScore = base(10) + email(30) + phone(40) + ipAddress(20) = 100
    expect(result.riskScore).toBe(100);
  });

  // ---------- enforce=true ----------

  it("should set allowed=false when enforce=true and PII found with riskScore >= 50", async () => {
    mockedDetectPII.mockReturnValue(makePIIDetectionResult({
      found: true,
      types: ["phone"],
      riskScore: 10,
      anonymized: "[REDACTED]",
    }));

    const reply = buildReply();
    const result = await routes["POST /check"].handler(
      buildRequest({ text: "555-123-4567", enforce: true }),
      reply,
    ) as Record<string, unknown>;

    // riskScore = base(10) + phone(40) = 50 -> NOT < 50
    expect(result.riskScore).toBe(50);
    expect(result.allowed).toBe(false);
  });

  it("should set allowed=true when enforce=true and PII found but riskScore < 50", async () => {
    mockedDetectPII.mockReturnValue(makePIIDetectionResult({
      found: true,
      types: ["ipAddress"],
      riskScore: 5,
      anonymized: "[REDACTED]",
    }));

    const reply = buildReply();
    const result = await routes["POST /check"].handler(
      buildRequest({ text: "192.168.1.1", enforce: true }),
      reply,
    ) as Record<string, unknown>;

    // riskScore = base(5) + ipAddress(20) = 25 < 50
    expect(result.riskScore).toBe(25);
    expect(result.allowed).toBe(true);
  });

  it("should set allowed=true when enforce=true but no PII found", async () => {
    mockedDetectPII.mockReturnValue(makePIIDetectionResult({
      found: false,
      riskScore: 0,
      anonymized: "safe text",
    }));

    const reply = buildReply();
    const result = await routes["POST /check"].handler(
      buildRequest({ text: "safe text", enforce: true }),
      reply,
    ) as Record<string, unknown>;

    expect(result.allowed).toBe(true);
  });

  // ---------- High-risk PII logging ----------

  it("should log a warning when riskScore >= 70", async () => {
    mockedDetectPII.mockReturnValue(makePIIDetectionResult({
      found: true,
      types: ["ssn"],
      riskScore: 0,
      anonymized: "[REDACTED]",
    }));

    const reply = buildReply();
    await routes["POST /check"].handler(
      buildRequest({ text: "123-45-6789" }),
      reply,
    );

    // riskScore = base(0) + ssn(100) = 100 >= 70
    expect(logger.warn).toHaveBeenCalledWith(
      { userId: "user-123", types: ["ssn"], riskScore: 100 },
      "High-risk PII detected in request",
    );
  });

  it("should not log a warning when riskScore < 70", async () => {
    mockedDetectPII.mockReturnValue(makePIIDetectionResult({
      found: true,
      types: ["email"],
      riskScore: 0,
      anonymized: "[REDACTED]",
    }));

    const reply = buildReply();
    await routes["POST /check"].handler(
      buildRequest({ text: "test@example.com" }),
      reply,
    );

    // riskScore = base(0) + email(30) = 30 < 70
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("should log warning at exactly riskScore=70", async () => {
    mockedDetectPII.mockReturnValue(makePIIDetectionResult({
      found: true,
      types: ["email", "phone"],
      riskScore: 0,
      anonymized: "[REDACTED]",
    }));

    const reply = buildReply();
    await routes["POST /check"].handler(
      buildRequest({ text: "some pii" }),
      reply,
    );

    // riskScore = base(0) + email(30) + phone(40) = 70 >= 70
    expect(logger.warn).toHaveBeenCalled();
  });

  // ---------- Message field ----------

  it("should include message with type names and risk score when PII found", async () => {
    mockedDetectPII.mockReturnValue(makePIIDetectionResult({
      found: true,
      types: ["email", "phone"],
      riskScore: 0,
      anonymized: "[REDACTED]",
    }));

    const reply = buildReply();
    const result = await routes["POST /check"].handler(
      buildRequest({ text: "contact info" }),
      reply,
    ) as Record<string, unknown>;

    expect(result.message).toBe("PII detected: email, phone. Risk score: 70");
  });

  it("should not include message when no PII found", async () => {
    mockedDetectPII.mockReturnValue(makePIIDetectionResult({
      found: false,
      anonymized: "clean",
    }));

    const reply = buildReply();
    const result = await routes["POST /check"].handler(
      buildRequest({ text: "clean" }),
      reply,
    ) as Record<string, unknown>;

    expect(result.message).toBeUndefined();
  });

  // ---------- Error handling ----------

  it("should throw AppError(500) when detectPII throws", async () => {
    mockedDetectPII.mockImplementation(() => {
      throw new Error("regex engine exploded");
    });

    const reply = buildReply();

    await expect(
      routes["POST /check"].handler(buildRequest({ text: "something" }), reply),
    ).rejects.toMatchObject({
      statusCode: 500,
      message: "PII check failed",
      code: "PII_CHECK_FAILED",
    });

    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.any(Error), userId: "user-123" }),
      "PII check failed",
    );
  });

  // ---------- Response shape ----------

  it("should return all expected fields in response", async () => {
    mockedDetectPII.mockReturnValue(makePIIDetectionResult({
      found: true,
      types: ["apiKey"],
      riskScore: 5,
      anonymized: "[API_KEY_REDACTED]",
    }));

    const reply = buildReply();
    const result = await routes["POST /check"].handler(
      buildRequest({ text: "key=sk-abc123" }),
      reply,
    ) as Record<string, unknown>;

    expect(result).toHaveProperty("found");
    expect(result).toHaveProperty("types");
    expect(result).toHaveProperty("riskScore");
    expect(result).toHaveProperty("anonymized");
    expect(result).toHaveProperty("allowed");
    expect(result).toHaveProperty("message");
  });

  // ---------- preHandler / auth middleware ----------

  it("should register the route with fastifyRequireAuth as preHandler", () => {
    const opts = routes["POST /check"].opts as { preHandler: unknown };
    // The preHandler should be the mocked fastifyRequireAuth
    expect(opts.preHandler).toBeDefined();
  });

  // ---------- Edge cases ----------

  it("should handle apiKey type with weight 80", async () => {
    mockedDetectPII.mockReturnValue(makePIIDetectionResult({
      found: true,
      types: ["apiKey"],
      riskScore: 0,
      anonymized: "[REDACTED]",
    }));

    const reply = buildReply();
    const result = await routes["POST /check"].handler(
      buildRequest({ text: "key" }),
      reply,
    ) as Record<string, unknown>;

    // riskScore = base(0) + apiKey(80) = 80
    expect(result.riskScore).toBe(80);
    expect(result.allowed).toBe(true); // enforce defaults to false
  });

  it("should pass correct text to detectPII", async () => {
    mockedDetectPII.mockReturnValue(makePIIDetectionResult());

    const reply = buildReply();
    await routes["POST /check"].handler(
      buildRequest({ text: "specific input text" }),
      reply,
    );

    expect(mockedDetectPII).toHaveBeenCalledWith("specific input text");
  });

  it("should use userId from request for logging", async () => {
    mockedDetectPII.mockImplementation(() => {
      throw new Error("fail");
    });

    const reply = buildReply();
    await expect(
      routes["POST /check"].handler(buildRequest({ text: "x" }, "custom-user-id"), reply),
    ).rejects.toThrow();

    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "custom-user-id" }),
      "PII check failed",
    );
  });
});
