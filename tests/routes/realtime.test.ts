import { describe, it, expect, vi, beforeEach } from "vitest";

// ---- mocks ----

const mockGetRealTimeData = vi.fn();
const mockStartSession = vi.fn();
const mockEndSession = vi.fn();
const mockGetLedger = vi.fn();
const mockGetStatistics = vi.fn();
const mockSetLimits = vi.fn();
const mockOnAlert = vi.fn();

vi.mock("../../src/lib/realtimeCost.js", () => ({
  realTimeCostTracker: {
    getRealTimeData: (...args: any[]) => mockGetRealTimeData(...args),
    startSession: (...args: any[]) => mockStartSession(...args),
    endSession: (...args: any[]) => mockEndSession(...args),
    getLedger: (...args: any[]) => mockGetLedger(...args),
    getStatistics: (...args: any[]) => mockGetStatistics(...args),
    setLimits: (...args: any[]) => mockSetLimits(...args),
    onAlert: (...args: any[]) => mockOnAlert(...args),
  },
}));

const mockJwtVerify = vi.fn();
vi.mock("jsonwebtoken", () => ({
  default: {
    verify: (...args: any[]) => mockJwtVerify(...args),
  },
}));

vi.mock("../../src/config/env.js", () => ({
  env: {
    JWT_SECRET: "test-secret",
  },
}));

vi.mock("../../src/middleware/fastifyAuth.js", () => ({
  fastifyRequireAuth: vi.fn(),
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

vi.mock("../../src/lib/logger.js", () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Mock WebSocketServer so the plugin constructor doesn't try to bind a real server
let wssConnectionHandler: ((ws: any) => void) | undefined;

vi.mock("ws", () => {
  const OPEN = 1;
  return {
    WebSocketServer: class {
      constructor() {}
      on(event: string, handler: any) {
        if (event === "connection") {
          wssConnectionHandler = handler;
        }
      }
    },
    WebSocket: { OPEN },
  };
});

// ---- helpers ----

type RouteEntry = {
  method: string;
  url: string;
  opts: any;
  handler: (request: any, reply: any) => Promise<any>;
};

const routes: RouteEntry[] = [];

function makeFastifyStub() {
  routes.length = 0;
  return {
    server: {},
    get(url: string, opts: any, handler: any) {
      routes.push({ method: "GET", url, opts, handler });
    },
    post(url: string, opts: any, handler: any) {
      routes.push({ method: "POST", url, opts, handler });
    },
  };
}

function findRoute(method: string, url: string): RouteEntry {
  const r = routes.find((r) => r.method === method && r.url === url);
  if (!r) throw new Error(`Route ${method} ${url} not registered`);
  return r;
}

function makeReply() {
  const reply: any = { _code: 200, _sent: null as any };
  reply.code = vi.fn((c: number) => {
    reply._code = c;
    return reply;
  });
  reply.send = vi.fn((body: any) => {
    reply._sent = body;
    return reply;
  });
  return reply;
}

function makeWs() {
  const ws: any = {
    userId: undefined,
    readyState: 1, // OPEN
    send: vi.fn(),
    _messageHandlers: [] as ((raw: any) => void)[],
    _closeHandlers: [] as (() => void)[],
    on(event: string, handler: any) {
      if (event === "message") ws._messageHandlers.push(handler);
      if (event === "close") ws._closeHandlers.push(handler);
    },
    triggerMessage(data: any) {
      const raw = JSON.stringify(data);
      ws._messageHandlers.forEach((h: any) => h(raw));
    },
    triggerClose() {
      ws._closeHandlers.forEach((h: any) => h());
    },
  };
  return ws;
}

// ---- register plugin ----

let plugin: any;

beforeEach(async () => {
  vi.clearAllMocks();
  wssConnectionHandler = undefined;
  const mod = await import("../../src/routes/realtime.js");
  plugin = mod.default;
});

async function registerPlugin() {
  const fastify = makeFastifyStub();
  await plugin(fastify as any);
  return fastify;
}

// ======== HTTP ROUTE TESTS ========

describe("POST /session/start", () => {
  it("returns success when sessionId and conversationId are provided", async () => {
    await registerPlugin();
    const route = findRoute("POST", "/session/start");
    const request = { userId: 42, body: { sessionId: "s1", conversationId: "c1" } };
    const reply = makeReply();

    const result = await route.handler(request, reply);

    expect(mockStartSession).toHaveBeenCalledWith(42, "s1", "c1");
    expect(result).toEqual({ success: true, sessionId: "s1", message: "Cost tracking started" });
  });

  it("returns 400 when sessionId is missing", async () => {
    await registerPlugin();
    const route = findRoute("POST", "/session/start");
    const request = { userId: 42, body: { conversationId: "c1" } };
    const reply = makeReply();

    await route.handler(request, reply);

    expect(reply.code).toHaveBeenCalledWith(400);
    expect(reply.send).toHaveBeenCalledWith({ error: "sessionId and conversationId are required" });
  });

  it("returns 400 when conversationId is missing", async () => {
    await registerPlugin();
    const route = findRoute("POST", "/session/start");
    const request = { userId: 42, body: { sessionId: "s1" } };
    const reply = makeReply();

    await route.handler(request, reply);

    expect(reply.code).toHaveBeenCalledWith(400);
    expect(reply.send).toHaveBeenCalledWith({ error: "sessionId and conversationId are required" });
  });

  it("returns 400 when body is empty", async () => {
    await registerPlugin();
    const route = findRoute("POST", "/session/start");
    const request = { userId: 42, body: {} };
    const reply = makeReply();

    await route.handler(request, reply);

    expect(reply.code).toHaveBeenCalledWith(400);
  });

  it("throws AppError when startSession throws", async () => {
    mockStartSession.mockImplementation(() => {
      throw new Error("db down");
    });

    await registerPlugin();
    const route = findRoute("POST", "/session/start");
    const request = { userId: 42, body: { sessionId: "s1", conversationId: "c1" } };
    const reply = makeReply();

    await expect(route.handler(request, reply)).rejects.toThrow("db down");
  });
});

describe("POST /session/end", () => {
  it("returns aggregated cost data on success", async () => {
    const entries = [
      { cost: 0.05, inputTokens: 100, outputTokens: 50 },
      { cost: 0.10, inputTokens: 200, outputTokens: 100 },
    ];
    mockEndSession.mockReturnValue(entries);

    await registerPlugin();
    const route = findRoute("POST", "/session/end");
    const request = { userId: 42, body: { sessionId: "s1" } };
    const reply = makeReply();

    const result = await route.handler(request, reply);

    expect(mockEndSession).toHaveBeenCalledWith("s1");
    expect(result).toEqual({
      success: true,
      sessionId: "s1",
      totalCost: expect.closeTo(0.15, 10),
      totalTokens: 450,
      requestCount: 2,
    });
  });

  it("returns 400 when sessionId is missing", async () => {
    await registerPlugin();
    const route = findRoute("POST", "/session/end");
    const request = { userId: 42, body: {} };
    const reply = makeReply();

    await route.handler(request, reply);

    expect(reply.code).toHaveBeenCalledWith(400);
    expect(reply.send).toHaveBeenCalledWith({ error: "sessionId is required" });
  });

  it("handles empty entries array", async () => {
    mockEndSession.mockReturnValue([]);

    await registerPlugin();
    const route = findRoute("POST", "/session/end");
    const request = { userId: 42, body: { sessionId: "s1" } };
    const reply = makeReply();

    const result = await route.handler(request, reply);

    expect(result).toEqual({
      success: true,
      sessionId: "s1",
      totalCost: 0,
      totalTokens: 0,
      requestCount: 0,
    });
  });

  it("throws AppError when endSession throws", async () => {
    mockEndSession.mockImplementation(() => {
      throw new Error("session not found");
    });

    await registerPlugin();
    const route = findRoute("POST", "/session/end");
    const request = { userId: 42, body: { sessionId: "s1" } };
    const reply = makeReply();

    await expect(route.handler(request, reply)).rejects.toThrow("session not found");
  });
});

describe("GET /ledger", () => {
  it("returns ledger on success", async () => {
    const ledger = { entries: [], total: 0 };
    mockGetLedger.mockReturnValue(ledger);

    await registerPlugin();
    const route = findRoute("GET", "/ledger");
    const request = { userId: 42 };
    const reply = makeReply();

    const result = await route.handler(request, reply);

    expect(mockGetLedger).toHaveBeenCalledWith(42);
    expect(result).toEqual({ success: true, ledger });
  });

  it("returns 404 when no ledger exists", async () => {
    mockGetLedger.mockReturnValue(null);

    await registerPlugin();
    const route = findRoute("GET", "/ledger");
    const request = { userId: 42 };
    const reply = makeReply();

    await route.handler(request, reply);

    expect(reply.code).toHaveBeenCalledWith(404);
    expect(reply.send).toHaveBeenCalledWith({ error: "No active cost tracking session" });
  });

  it("returns 404 when ledger is undefined", async () => {
    mockGetLedger.mockReturnValue(undefined);

    await registerPlugin();
    const route = findRoute("GET", "/ledger");
    const request = { userId: 42 };
    const reply = makeReply();

    await route.handler(request, reply);

    expect(reply.code).toHaveBeenCalledWith(404);
  });

  it("throws AppError when getLedger throws", async () => {
    mockGetLedger.mockImplementation(() => {
      throw new Error("storage error");
    });

    await registerPlugin();
    const route = findRoute("GET", "/ledger");
    const request = { userId: 42 };
    const reply = makeReply();

    await expect(route.handler(request, reply)).rejects.toThrow("storage error");
  });
});

describe("GET /statistics", () => {
  it("returns statistics with default hours", async () => {
    const stats = { totalCost: 1.5, requestCount: 10 };
    mockGetStatistics.mockReturnValue(stats);

    await registerPlugin();
    const route = findRoute("GET", "/statistics");
    const request = { userId: 42, query: {} };
    const reply = makeReply();

    const result = await route.handler(request, reply);

    expect(mockGetStatistics).toHaveBeenCalledWith(42, 24);
    expect(result).toEqual({ success: true, statistics: stats });
  });

  it("respects custom hours parameter", async () => {
    const stats = { totalCost: 0.5, requestCount: 3 };
    mockGetStatistics.mockReturnValue(stats);

    await registerPlugin();
    const route = findRoute("GET", "/statistics");
    const request = { userId: 42, query: { hours: "48" } };
    const reply = makeReply();

    const result = await route.handler(request, reply);

    expect(mockGetStatistics).toHaveBeenCalledWith(42, 48);
    expect(result).toEqual({ success: true, statistics: stats });
  });

  it("throws AppError when getStatistics throws", async () => {
    mockGetStatistics.mockImplementation(() => {
      throw new Error("calc error");
    });

    await registerPlugin();
    const route = findRoute("GET", "/statistics");
    const request = { userId: 42, query: {} };
    const reply = makeReply();

    await expect(route.handler(request, reply)).rejects.toThrow("calc error");
  });
});

// ======== WEBSOCKET TESTS ========

describe("WebSocket connection", () => {
  describe("authenticate message", () => {
    it("authenticates user via JWT and sends initial cost data", async () => {
      const costData = { totalCost: 1.0 };
      mockJwtVerify.mockReturnValue({ userId: 7 });
      mockGetRealTimeData.mockReturnValue(costData);

      await registerPlugin();
      const ws = makeWs();
      wssConnectionHandler!(ws);

      ws.triggerMessage({ type: "authenticate", token: "valid-jwt" });

      expect(mockJwtVerify).toHaveBeenCalledWith("valid-jwt", "test-secret", { algorithms: ["HS256"] });
      expect(ws.userId).toBe(7);
      expect(ws.send).toHaveBeenCalledWith(
        JSON.stringify({ event: "cost-update", data: costData })
      );
      expect(mockOnAlert).toHaveBeenCalledWith(7, expect.any(Function));
    });

    it("extracts userId from payload.id fallback", async () => {
      mockJwtVerify.mockReturnValue({ id: 99 });
      mockGetRealTimeData.mockReturnValue(null);

      await registerPlugin();
      const ws = makeWs();
      wssConnectionHandler!(ws);

      ws.triggerMessage({ type: "authenticate", token: "tok" });

      expect(ws.userId).toBe(99);
    });

    it("extracts userId from payload.sub fallback", async () => {
      mockJwtVerify.mockReturnValue({ sub: 55 });
      mockGetRealTimeData.mockReturnValue(null);

      await registerPlugin();
      const ws = makeWs();
      wssConnectionHandler!(ws);

      ws.triggerMessage({ type: "authenticate", token: "tok" });

      expect(ws.userId).toBe(55);
    });

    it("does not send cost-update when no costData is available", async () => {
      mockJwtVerify.mockReturnValue({ userId: 7 });
      mockGetRealTimeData.mockReturnValue(null);

      await registerPlugin();
      const ws = makeWs();
      wssConnectionHandler!(ws);

      ws.triggerMessage({ type: "authenticate", token: "tok" });

      expect(ws.send).not.toHaveBeenCalled();
    });

    it("sends error when token is missing", async () => {
      await registerPlugin();
      const ws = makeWs();
      wssConnectionHandler!(ws);

      ws.triggerMessage({ type: "authenticate" });

      expect(ws.send).toHaveBeenCalledWith(
        JSON.stringify({ event: "error", data: { message: "Authentication token required" } })
      );
      expect(ws.userId).toBeUndefined();
    });

    it("sends error when JWT verification fails", async () => {
      mockJwtVerify.mockImplementation(() => {
        throw new Error("jwt expired");
      });

      await registerPlugin();
      const ws = makeWs();
      wssConnectionHandler!(ws);

      ws.triggerMessage({ type: "authenticate", token: "bad-jwt" });

      expect(ws.send).toHaveBeenCalledWith(
        JSON.stringify({ event: "error", data: { message: "Invalid or expired token" } })
      );
      expect(ws.userId).toBeUndefined();
    });

    it("sends error when token has no userId field", async () => {
      mockJwtVerify.mockReturnValue({ email: "test@test.com" });

      await registerPlugin();
      const ws = makeWs();
      wssConnectionHandler!(ws);

      ws.triggerMessage({ type: "authenticate", token: "no-uid" });

      expect(ws.send).toHaveBeenCalledWith(
        JSON.stringify({ event: "error", data: { message: "Invalid token: no userId" } })
      );
      expect(ws.userId).toBeUndefined();
    });
  });

  describe("alert callback", () => {
    it("sends cost-alert when ws is OPEN", async () => {
      mockJwtVerify.mockReturnValue({ userId: 7 });
      mockGetRealTimeData.mockReturnValue(null);

      let alertCb: any;
      mockOnAlert.mockImplementation((_uid: number, cb: any) => {
        alertCb = cb;
      });

      await registerPlugin();
      const ws = makeWs();
      ws.readyState = 1; // OPEN
      wssConnectionHandler!(ws);

      ws.triggerMessage({ type: "authenticate", token: "tok" });

      const alerts = [{ type: "over-budget" }];
      alertCb(alerts);

      const sent = JSON.parse(ws.send.mock.calls[0][0]);
      expect(sent.event).toBe("cost-alert");
      expect(sent.data.alerts).toEqual(alerts);
      expect(sent.data.timestamp).toBeDefined();
    });

    it("does not send cost-alert when ws is CLOSED", async () => {
      mockJwtVerify.mockReturnValue({ userId: 7 });
      mockGetRealTimeData.mockReturnValue(null);

      let alertCb: any;
      mockOnAlert.mockImplementation((_uid: number, cb: any) => {
        alertCb = cb;
      });

      await registerPlugin();
      const ws = makeWs();
      wssConnectionHandler!(ws);

      ws.triggerMessage({ type: "authenticate", token: "tok" });

      ws.readyState = 3; // CLOSED
      alertCb([{ type: "limit-exceeded" }]);

      expect(ws.send).not.toHaveBeenCalled();
    });
  });

  describe("request-cost-data message", () => {
    it("sends cost data when authenticated", async () => {
      const costData = { totalCost: 2.0 };
      mockGetRealTimeData.mockReturnValue(costData);

      await registerPlugin();
      const ws = makeWs();
      ws.userId = 10;
      wssConnectionHandler!(ws);

      ws.triggerMessage({ type: "request-cost-data" });

      expect(mockGetRealTimeData).toHaveBeenCalledWith(10);
      expect(ws.send).toHaveBeenCalledWith(
        JSON.stringify({ event: "cost-update", data: costData })
      );
    });

    it("does not send when costData is null", async () => {
      mockGetRealTimeData.mockReturnValue(null);

      await registerPlugin();
      const ws = makeWs();
      ws.userId = 10;
      wssConnectionHandler!(ws);

      ws.triggerMessage({ type: "request-cost-data" });

      expect(ws.send).not.toHaveBeenCalled();
    });

    it("ignores request-cost-data when not authenticated", async () => {
      await registerPlugin();
      const ws = makeWs();
      wssConnectionHandler!(ws);

      ws.triggerMessage({ type: "request-cost-data" });

      expect(mockGetRealTimeData).not.toHaveBeenCalled();
    });
  });

  describe("set-limits message", () => {
    it("calls setLimits when authenticated", async () => {
      await registerPlugin();
      const ws = makeWs();
      ws.userId = 10;
      wssConnectionHandler!(ws);

      ws.triggerMessage({ type: "set-limits", dailyLimit: 5, monthlyLimit: 100 });

      expect(mockSetLimits).toHaveBeenCalledWith(10, 5, 100);
    });

    it("ignores set-limits when not authenticated", async () => {
      await registerPlugin();
      const ws = makeWs();
      wssConnectionHandler!(ws);

      ws.triggerMessage({ type: "set-limits", dailyLimit: 5, monthlyLimit: 100 });

      expect(mockSetLimits).not.toHaveBeenCalled();
    });
  });

  describe("get-statistics message", () => {
    it("sends statistics when authenticated", async () => {
      const stats = { avgCost: 0.5 };
      mockGetStatistics.mockReturnValue(stats);

      await registerPlugin();
      const ws = makeWs();
      ws.userId = 10;
      wssConnectionHandler!(ws);

      ws.triggerMessage({ type: "get-statistics", hours: 12 });

      expect(mockGetStatistics).toHaveBeenCalledWith(10, 12);
      expect(ws.send).toHaveBeenCalledWith(
        JSON.stringify({ event: "statistics-update", data: stats })
      );
    });

    it("ignores get-statistics when not authenticated", async () => {
      await registerPlugin();
      const ws = makeWs();
      wssConnectionHandler!(ws);

      ws.triggerMessage({ type: "get-statistics", hours: 12 });

      expect(mockGetStatistics).not.toHaveBeenCalled();
    });
  });

  describe("invalid messages", () => {
    it("silently ignores invalid JSON", async () => {
      await registerPlugin();
      const ws = makeWs();
      wssConnectionHandler!(ws);

      // Trigger raw handler directly with non-JSON
      ws._messageHandlers.forEach((h: any) => h("not-json"));

      expect(ws.send).not.toHaveBeenCalled();
    });
  });

  describe("close event", () => {
    it("logs disconnect for authenticated user", async () => {
      const { default: logger } = await import("../../src/lib/logger.js");

      await registerPlugin();
      const ws = makeWs();
      ws.userId = 42;
      wssConnectionHandler!(ws);

      ws.triggerClose();

      expect(logger.info).toHaveBeenCalledWith(
        { userId: 42 },
        "User disconnected from real-time updates"
      );
    });

    it("does not log disconnect for unauthenticated user", async () => {
      const { default: logger } = await import("../../src/lib/logger.js");
      vi.mocked(logger.info).mockClear();

      await registerPlugin();
      const ws = makeWs();
      wssConnectionHandler!(ws);

      ws.triggerClose();

      // The info call for "User connected" happens, but not the disconnect one
      const disconnectCalls = vi.mocked(logger.info).mock.calls.filter(
        (c) => c[1] === "User disconnected from real-time updates"
      );
      expect(disconnectCalls).toHaveLength(0);
    });
  });
});
