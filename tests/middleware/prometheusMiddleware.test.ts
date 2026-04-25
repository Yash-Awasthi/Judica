import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockTimerFn, mockStartTimer, mockInc } = vi.hoisted(() => {
  const mockTimerFn = vi.fn();
  const mockStartTimer = vi.fn(() => mockTimerFn);
  const mockInc = vi.fn();
  return { mockTimerFn, mockStartTimer, mockInc };
});

vi.mock("../../src/lib/prometheusMetrics.js", () => ({
  httpRequestDuration: {
    startTimer: mockStartTimer,
  },
  httpRequestTotal: {
    inc: mockInc,
  },
}));

import {
  fastifyPrometheusOnRequest,
  fastifyPrometheusOnResponse,
} from "../../src/middleware/prometheusMiddleware.js";

function createRequest(overrides: any = {}): any {
  const listeners: Record<string, Function[]> = {};
  return {
    method: "GET",
    url: "/api/ask/123",
    routeOptions: { url: "/api/ask/:id" },
    metricsTimer: undefined,
    metricsCloseHandler: undefined,
    raw: {
      on: vi.fn((event: string, handler: Function) => {
        if (!listeners[event]) listeners[event] = [];
        listeners[event].push(handler);
      }),
      removeListener: vi.fn((event: string, handler: Function) => {
        if (listeners[event]) {
          listeners[event] = listeners[event].filter((h) => h !== handler);
        }
      }),
      _listeners: listeners,
    },
    ...overrides,
  };
}

function createReply(overrides: any = {}): any {
  return {
    statusCode: 200,
    ...overrides,
  };
}

describe("fastifyPrometheusOnRequest", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sets metricsTimer on request", async () => {
    const request = createRequest();
    const reply = createReply();
    await fastifyPrometheusOnRequest(request, reply);
    expect(mockStartTimer).toHaveBeenCalled();
    expect(request.metricsTimer).toBe(mockTimerFn);
  });

  it("attaches close handler to raw request", async () => {
    const request = createRequest();
    const reply = createReply();
    await fastifyPrometheusOnRequest(request, reply);
    expect(request.raw.on).toHaveBeenCalledWith("close", expect.any(Function));
    expect(request.metricsCloseHandler).toBeDefined();
  });

  it("close handler calls timer with 499 status on abort", async () => {
    const request = createRequest({
      method: "POST",
      routeOptions: { url: "/api/ask" },
    });
    const reply = createReply();
    await fastifyPrometheusOnRequest(request, reply);

    // Simulate connection abort
    const closeHandler = request.metricsCloseHandler;
    closeHandler();

    expect(mockTimerFn).toHaveBeenCalledWith({
      method: "POST",
      route: "/api/ask",
      status_code: "499",
    });
    expect(request.metricsTimer).toBeUndefined();
  });
});

describe("fastifyPrometheusOnResponse", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls timer with method, route, status_code", async () => {
    const request = createRequest({
      method: "GET",
      routeOptions: { url: "/api/ask/:id" },
      metricsTimer: mockTimerFn,
      metricsCloseHandler: vi.fn(),
    });
    const reply = createReply({ statusCode: 200 });
    await fastifyPrometheusOnResponse(request, reply);
    expect(mockTimerFn).toHaveBeenCalledWith({
      method: "GET",
      route: "/api/ask/:id",
      status_code: "200",
    });
  });

  it("increments httpRequestTotal counter", async () => {
    const request = createRequest({
      method: "POST",
      routeOptions: { url: "/api/ask" },
      metricsTimer: mockTimerFn,
      metricsCloseHandler: vi.fn(),
    });
    const reply = createReply({ statusCode: 201 });
    await fastifyPrometheusOnResponse(request, reply);
    expect(mockInc).toHaveBeenCalledWith({
      method: "POST",
      route: "/api/ask",
      status_code: "201",
    });
  });

  it("clears metricsTimer after use", async () => {
    const request = createRequest({
      metricsTimer: mockTimerFn,
      metricsCloseHandler: vi.fn(),
    });
    const reply = createReply();
    await fastifyPrometheusOnResponse(request, reply);
    expect(request.metricsTimer).toBeUndefined();
  });

  it("removes close handler from raw request", async () => {
    const closeHandler = vi.fn();
    const request = createRequest({
      metricsTimer: mockTimerFn,
      metricsCloseHandler: closeHandler,
    });
    const reply = createReply();
    await fastifyPrometheusOnResponse(request, reply);
    expect(request.raw.removeListener).toHaveBeenCalledWith("close", closeHandler);
    expect(request.metricsCloseHandler).toBeUndefined();
  });

  it("uses routeOptions.url (pattern) not request.url (actual)", async () => {
    const request = createRequest({
      method: "GET",
      url: "/api/ask/abc-123-def",
      routeOptions: { url: "/api/ask/:id" },
      metricsTimer: mockTimerFn,
      metricsCloseHandler: vi.fn(),
    });
    const reply = createReply({ statusCode: 200 });
    await fastifyPrometheusOnResponse(request, reply);
    expect(mockTimerFn).toHaveBeenCalledWith(
      expect.objectContaining({ route: "/api/ask/:id" })
    );
    // Verify we did NOT use the actual URL
    expect(mockTimerFn).not.toHaveBeenCalledWith(
      expect.objectContaining({ route: "/api/ask/abc-123-def" })
    );
  });

  it("falls back to 'unmatched' when routeOptions.url is absent", async () => {
    const request = createRequest({
      routeOptions: {},
      metricsTimer: mockTimerFn,
      metricsCloseHandler: vi.fn(),
    });
    const reply = createReply({ statusCode: 404 });
    await fastifyPrometheusOnResponse(request, reply);
    expect(mockTimerFn).toHaveBeenCalledWith(
      expect.objectContaining({ route: "unmatched" })
    );
  });

  it("does nothing when metricsTimer is undefined", async () => {
    const request = createRequest({ metricsTimer: undefined });
    const reply = createReply();
    await fastifyPrometheusOnResponse(request, reply);
    expect(mockTimerFn).not.toHaveBeenCalled();
    expect(mockInc).not.toHaveBeenCalled();
  });
});
