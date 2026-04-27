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

vi.mock("../../src/services/notification.service.js", () => ({
  getUserNotifications: vi.fn(),
  getUnreadCount: vi.fn(),
  markAsRead: vi.fn(),
  dismissNotification: vi.fn(),
  dismissAll: vi.fn(),
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

describe("notifications routes", () => {
  let fastify: any;
  let getUserNotifications: any;
  let getUnreadCount: any;
  let markAsRead: any;
  let dismissNotification: any;
  let dismissAll: any;

  beforeEach(async () => {
    for (const key of Object.keys(registeredRoutes)) {
      delete registeredRoutes[key];
    }
    vi.clearAllMocks();

    fastify = createFastifyInstance();

    const svc = await import("../../src/services/notification.service.js");
    getUserNotifications = svc.getUserNotifications as any;
    getUnreadCount = svc.getUnreadCount as any;
    markAsRead = svc.markAsRead as any;
    dismissNotification = svc.dismissNotification as any;
    dismissAll = svc.dismissAll as any;

    getUserNotifications.mockResolvedValue([{ id: 1, message: "hello" }]);
    getUnreadCount.mockResolvedValue(3);
    markAsRead.mockResolvedValue(undefined);
    dismissNotification.mockResolvedValue(undefined);
    dismissAll.mockResolvedValue(undefined);

    const { default: notificationsPlugin } = await import("../../src/routes/notifications.js");
    await notificationsPlugin(fastify, {});
  });

  describe("GET /", () => {
    it("registers the GET / route", () => {
      expect(registeredRoutes["GET /"]).toBeDefined();
    });

    it("returns notifications and unreadCount", async () => {
      const { handler } = registeredRoutes["GET /"];
      const req = makeReq({ query: {} });
      const reply = makeReply();
      const result = await handler(req, reply);
      expect(result.notifications).toEqual([{ id: 1, message: "hello" }]);
      expect(result.unreadCount).toBe(3);
    });

    it("passes userId to getUserNotifications", async () => {
      const { handler } = registeredRoutes["GET /"];
      const req = makeReq({ userId: 42, query: {} });
      const reply = makeReply();
      await handler(req, reply);
      expect(getUserNotifications).toHaveBeenCalledWith(42, expect.any(Object));
    });

    it("passes includeDismissed=true when query param is 'true'", async () => {
      const { handler } = registeredRoutes["GET /"];
      const req = makeReq({ query: { includeDismissed: "true" } });
      const reply = makeReply();
      await handler(req, reply);
      expect(getUserNotifications).toHaveBeenCalledWith(
        1,
        expect.objectContaining({ includeDismissed: true }),
      );
    });

    it("passes limit and offset from query params", async () => {
      const { handler } = registeredRoutes["GET /"];
      const req = makeReq({ query: { limit: "10", offset: "5" } });
      const reply = makeReply();
      await handler(req, reply);
      expect(getUserNotifications).toHaveBeenCalledWith(
        1,
        expect.objectContaining({ limit: 10, offset: 5 }),
      );
    });

    it("has preHandler auth middleware", () => {
      const route = registeredRoutes["GET /"];
      expect(route.preHandler).toBeDefined();
    });
  });

  describe("GET /count", () => {
    it("registers the GET /count route", () => {
      expect(registeredRoutes["GET /count"]).toBeDefined();
    });

    it("returns only unreadCount", async () => {
      const { handler } = registeredRoutes["GET /count"];
      const req = makeReq();
      const reply = makeReply();
      const result = await handler(req, reply);
      expect(result.unreadCount).toBe(3);
      expect(result.notifications).toBeUndefined();
    });

    it("calls getUnreadCount with the userId", async () => {
      const { handler } = registeredRoutes["GET /count"];
      const req = makeReq({ userId: 99 });
      const reply = makeReply();
      await handler(req, reply);
      expect(getUnreadCount).toHaveBeenCalledWith(99);
    });

    it("has preHandler auth middleware", () => {
      const route = registeredRoutes["GET /count"];
      expect(route.preHandler).toBeDefined();
    });
  });

  describe("POST /:id/read", () => {
    it("registers the POST /:id/read route", () => {
      expect(registeredRoutes["POST /:id/read"]).toBeDefined();
    });

    it("returns success: true for a valid numeric ID", async () => {
      const { handler } = registeredRoutes["POST /:id/read"];
      const req = makeReq({ params: { id: "5" } });
      const reply = makeReply();
      const result = await handler(req, reply);
      expect(result.success).toBe(true);
      expect(markAsRead).toHaveBeenCalledWith(1, 5);
    });

    it("throws AppError 400 for a non-numeric ID", async () => {
      const { handler } = registeredRoutes["POST /:id/read"];
      const req = makeReq({ params: { id: "abc" } });
      const reply = makeReply();
      await expect(handler(req, reply)).rejects.toMatchObject({ statusCode: 400 });
    });

    it("has preHandler auth middleware", () => {
      const route = registeredRoutes["POST /:id/read"];
      expect(route.preHandler).toBeDefined();
    });
  });

  describe("POST /:id/dismiss", () => {
    it("registers the POST /:id/dismiss route", () => {
      expect(registeredRoutes["POST /:id/dismiss"]).toBeDefined();
    });

    it("returns success: true for a valid numeric ID", async () => {
      const { handler } = registeredRoutes["POST /:id/dismiss"];
      const req = makeReq({ params: { id: "7" } });
      const reply = makeReply();
      const result = await handler(req, reply);
      expect(result.success).toBe(true);
      expect(dismissNotification).toHaveBeenCalledWith(1, 7);
    });

    it("throws AppError 400 for a non-numeric ID", async () => {
      const { handler } = registeredRoutes["POST /:id/dismiss"];
      const req = makeReq({ params: { id: "not-a-number" } });
      const reply = makeReply();
      await expect(handler(req, reply)).rejects.toMatchObject({ statusCode: 400 });
    });

    it("has preHandler auth middleware", () => {
      const route = registeredRoutes["POST /:id/dismiss"];
      expect(route.preHandler).toBeDefined();
    });
  });

  describe("POST /dismiss-all", () => {
    it("registers the POST /dismiss-all route", () => {
      expect(registeredRoutes["POST /dismiss-all"]).toBeDefined();
    });

    it("returns success: true", async () => {
      const { handler } = registeredRoutes["POST /dismiss-all"];
      const req = makeReq({ userId: 10 });
      const reply = makeReply();
      const result = await handler(req, reply);
      expect(result.success).toBe(true);
    });

    it("calls dismissAll with the userId", async () => {
      const { handler } = registeredRoutes["POST /dismiss-all"];
      const req = makeReq({ userId: 10 });
      const reply = makeReply();
      await handler(req, reply);
      expect(dismissAll).toHaveBeenCalledWith(10);
    });

    it("has preHandler auth middleware", () => {
      const route = registeredRoutes["POST /dismiss-all"];
      expect(route.preHandler).toBeDefined();
    });
  });
});
