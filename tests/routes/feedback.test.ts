import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock all external dependencies at top level
vi.mock("../../src/middleware/fastifyAuth.js", () => ({
  fastifyRequireAuth: vi.fn(),
  fastifyRequireAdmin: vi.fn(),
}));

vi.mock("../../src/middleware/errorHandler.js", () => ({
  AppError: class AppError extends Error {
    statusCode: number;
    constructor(code: number, msg: string) {
      super(msg);
      this.statusCode = code;
    }
  },
}));

vi.mock("../../src/services/feedback.service.js", () => ({
  submitResponseFeedback: vi.fn(),
  submitSearchFeedback: vi.fn(),
  getFeedbackStats: vi.fn(),
  exportFeedback: vi.fn(),
}));

// Helper to capture Fastify route handlers
const registeredRoutes: Record<string, { handler: Function; preHandler?: Function }> = {};
function createFastifyInstance(): any {
  const register = (method: string) =>
    vi.fn((path: string, opts: any, handler?: Function) => {
      const h = handler ?? opts;
      const pre = handler ? opts?.preHandler : undefined;
      registeredRoutes[`${method.toUpperCase()} ${path}`] = { handler: h, preHandler: pre };
    });
  return {
    get: register("GET"),
    post: register("POST"),
    put: register("PUT"),
    delete: register("DELETE"),
    patch: register("PATCH"),
    addHook: vi.fn(),
    addContentTypeParser: vi.fn(),
    register: vi.fn(),
  };
}

// Mock request/reply helpers
function makeReq(overrides = {}): any {
  return { userId: 1, role: "member", body: {}, params: {}, query: {}, headers: {}, ...overrides };
}
function makeReply(): any {
  const r: any = { _code: 200, _body: undefined };
  r.code = vi.fn((c: number) => { r._code = c; return r; });
  r.send = vi.fn((b?: any) => { r._body = b; return r; });
  r.header = vi.fn(() => r);
  return r;
}

describe("feedback routes", () => {
  let fastify: any;
  let submitResponseFeedback: any;
  let submitSearchFeedback: any;
  let getFeedbackStats: any;
  let exportFeedback: any;

  beforeEach(async () => {
    for (const key of Object.keys(registeredRoutes)) {
      delete registeredRoutes[key];
    }
    vi.clearAllMocks();

    fastify = createFastifyInstance();

    const svc = await import("../../src/services/feedback.service.js");
    submitResponseFeedback = svc.submitResponseFeedback as any;
    submitSearchFeedback = svc.submitSearchFeedback as any;
    getFeedbackStats = svc.getFeedbackStats as any;
    exportFeedback = svc.exportFeedback as any;

    submitResponseFeedback.mockResolvedValue({ id: 1, rating: "positive" });
    submitSearchFeedback.mockResolvedValue({ id: 2, isRelevant: true });
    getFeedbackStats.mockResolvedValue({ totalPositive: 10, totalNegative: 2 });
    exportFeedback.mockResolvedValue('[{"id":1}]');

    const { default: feedbackPlugin } = await import("../../src/routes/feedback.js");
    await feedbackPlugin(fastify, {});
  });

  describe("POST /response", () => {
    it("registers the POST /response route", () => {
      expect(registeredRoutes["POST /response"]).toBeDefined();
    });

    it("returns 201 with feedback result for a valid request", async () => {
      const { handler } = registeredRoutes["POST /response"];
      const req = makeReq({
        userId: 5,
        body: { conversationId: "conv-1", messageIndex: 0, rating: "positive" },
      });
      const reply = makeReply();
      const result = await handler(req, reply);
      expect(reply.code).toHaveBeenCalledWith(201);
      expect(result).toEqual({ id: 1, rating: "positive" });
    });

    it("throws AppError 400 when conversationId is missing", async () => {
      const { handler } = registeredRoutes["POST /response"];
      const req = makeReq({
        body: { messageIndex: 0, rating: "positive" },
      });
      const reply = makeReply();
      await expect(handler(req, reply)).rejects.toMatchObject({ statusCode: 400 });
    });

    it("throws AppError 400 when messageIndex is not a number", async () => {
      const { handler } = registeredRoutes["POST /response"];
      const req = makeReq({
        body: { conversationId: "c1", messageIndex: "zero", rating: "positive" },
      });
      const reply = makeReply();
      await expect(handler(req, reply)).rejects.toMatchObject({ statusCode: 400 });
    });

    it("throws AppError 400 when rating is invalid", async () => {
      const { handler } = registeredRoutes["POST /response"];
      const req = makeReq({
        body: { conversationId: "c1", messageIndex: 0, rating: "meh" },
      });
      const reply = makeReply();
      await expect(handler(req, reply)).rejects.toMatchObject({ statusCode: 400 });
    });

    it("accepts 'negative' as a valid rating", async () => {
      const { handler } = registeredRoutes["POST /response"];
      const req = makeReq({
        body: { conversationId: "c1", messageIndex: 1, rating: "negative" },
      });
      const reply = makeReply();
      await handler(req, reply);
      expect(submitResponseFeedback).toHaveBeenCalledWith(
        expect.objectContaining({ rating: "negative" }),
      );
    });

    it("passes userId and optional fields to the service", async () => {
      const { handler } = registeredRoutes["POST /response"];
      const req = makeReq({
        userId: 99,
        body: {
          conversationId: "conv-xyz",
          messageIndex: 2,
          rating: "positive",
          feedbackText: "Great answer",
          qualityIssues: ["factual_error"],
        },
      });
      const reply = makeReply();
      await handler(req, reply);
      expect(submitResponseFeedback).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 99,
          conversationId: "conv-xyz",
          messageIndex: 2,
          feedbackText: "Great answer",
          qualityIssues: ["factual_error"],
        }),
      );
    });

    it("has preHandler auth middleware", () => {
      const route = registeredRoutes["POST /response"];
      expect(route.preHandler).toBeDefined();
    });
  });

  describe("POST /search", () => {
    it("registers the POST /search route", () => {
      expect(registeredRoutes["POST /search"]).toBeDefined();
    });

    it("returns 201 with feedback result for a valid request", async () => {
      const { handler } = registeredRoutes["POST /search"];
      const req = makeReq({
        body: { query: "how to deploy", documentId: "doc-1", isRelevant: true },
      });
      const reply = makeReply();
      const result = await handler(req, reply);
      expect(reply.code).toHaveBeenCalledWith(201);
      expect(result).toEqual({ id: 2, isRelevant: true });
    });

    it("throws AppError 400 when query is missing", async () => {
      const { handler } = registeredRoutes["POST /search"];
      const req = makeReq({
        body: { documentId: "doc-1", isRelevant: false },
      });
      const reply = makeReply();
      await expect(handler(req, reply)).rejects.toMatchObject({ statusCode: 400 });
    });

    it("throws AppError 400 when documentId is missing", async () => {
      const { handler } = registeredRoutes["POST /search"];
      const req = makeReq({
        body: { query: "search term", isRelevant: true },
      });
      const reply = makeReply();
      await expect(handler(req, reply)).rejects.toMatchObject({ statusCode: 400 });
    });

    it("throws AppError 400 when isRelevant is not a boolean", async () => {
      const { handler } = registeredRoutes["POST /search"];
      const req = makeReq({
        body: { query: "q", documentId: "d1", isRelevant: "yes" },
      });
      const reply = makeReply();
      await expect(handler(req, reply)).rejects.toMatchObject({ statusCode: 400 });
    });

    it("passes tenantId and userId to the service", async () => {
      const { handler } = registeredRoutes["POST /search"];
      const req = makeReq({
        userId: 10,
        body: { query: "test", documentId: "d2", isRelevant: false, tenantId: "t1" },
      });
      const reply = makeReply();
      await handler(req, reply);
      expect(submitSearchFeedback).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 10, tenantId: "t1" }),
      );
    });

    it("has preHandler auth middleware", () => {
      const route = registeredRoutes["POST /search"];
      expect(route.preHandler).toBeDefined();
    });
  });

  describe("GET /stats", () => {
    it("registers the GET /stats route", () => {
      expect(registeredRoutes["GET /stats"]).toBeDefined();
    });

    it("returns feedback stats", async () => {
      const { handler } = registeredRoutes["GET /stats"];
      const req = makeReq({ query: {} });
      const reply = makeReply();
      const result = await handler(req, reply);
      expect(result).toEqual({ totalPositive: 10, totalNegative: 2 });
    });

    it("passes tenantId and date range to the service", async () => {
      const { handler } = registeredRoutes["GET /stats"];
      const req = makeReq({ query: { tenantId: "t1", from: "2024-01-01", to: "2024-12-31" } });
      const reply = makeReply();
      await handler(req, reply);
      expect(getFeedbackStats).toHaveBeenCalledWith(
        "t1",
        expect.objectContaining({
          from: expect.any(Date),
          to: expect.any(Date),
        }),
      );
    });

    it("has preHandler admin middleware", () => {
      const route = registeredRoutes["GET /stats"];
      expect(route.preHandler).toBeDefined();
    });
  });

  describe("GET /export", () => {
    it("registers the GET /export route", () => {
      expect(registeredRoutes["GET /export"]).toBeDefined();
    });

    it("defaults to JSON format and sets Content-Type header", async () => {
      const { handler } = registeredRoutes["GET /export"];
      const req = makeReq({ query: {} });
      const reply = makeReply();
      await handler(req, reply);
      expect(reply.header).toHaveBeenCalledWith("Content-Type", "application/json");
    });

    it("sets CSV headers when format=csv is requested", async () => {
      exportFeedback.mockResolvedValue("id,rating\n1,positive");
      const { handler } = registeredRoutes["GET /export"];
      const req = makeReq({ query: { format: "csv" } });
      const reply = makeReply();
      await handler(req, reply);
      expect(reply.header).toHaveBeenCalledWith("Content-Type", "text/csv");
      expect(reply.header).toHaveBeenCalledWith(
        "Content-Disposition",
        "attachment; filename=feedback-export.csv",
      );
    });

    it("throws AppError 400 for an invalid format", async () => {
      const { handler } = registeredRoutes["GET /export"];
      const req = makeReq({ query: { format: "xml" } });
      const reply = makeReply();
      await expect(handler(req, reply)).rejects.toMatchObject({ statusCode: 400 });
    });

    it("has preHandler admin middleware", () => {
      const route = registeredRoutes["GET /export"];
      expect(route.preHandler).toBeDefined();
    });
  });
});
