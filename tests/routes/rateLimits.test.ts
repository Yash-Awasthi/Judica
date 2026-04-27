import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/middleware/fastifyAuth.js", () => ({
  fastifyRequireAuth: vi.fn(),
  fastifyRequireAdmin: vi.fn(),
}));

vi.mock("../../src/services/rateLimit.service.js", () => ({
  checkRateLimit: vi.fn(),
  listTiers: vi.fn(),
  createTier: vi.fn(),
  updateTier: vi.fn(),
  deleteTier: vi.fn(),
  setUserTier: vi.fn(),
  removeUserTier: vi.fn(),
  setGroupTier: vi.fn(),
  removeGroupTier: vi.fn(),
}));

import {
  checkRateLimit,
  listTiers,
  createTier,
  updateTier,
  deleteTier,
  setUserTier,
  removeUserTier,
  setGroupTier,
  removeGroupTier,
} from "../../src/services/rateLimit.service.js";

const registeredRoutes: Record<string, { handler: Function }> = {};

function createFastifyInstance(): any {
  const register = (method: string) =>
    vi.fn((path: string, opts: any, handler?: Function) => {
      registeredRoutes[`${method.toUpperCase()} ${path}`] = {
        handler: handler ?? opts,
      };
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

function makeReq(overrides = {}): any {
  return {
    userId: 1,
    role: "member",
    body: {},
    params: {},
    query: {},
    headers: {},
    ...overrides,
  };
}

function makeReply(): any {
  const r: any = {};
  r.code = vi.fn(() => r);
  r.send = vi.fn(() => r);
  r.header = vi.fn(() => r);
  r.status = vi.fn(() => r);
  return r;
}

let fastify: any;

beforeEach(async () => {
  vi.clearAllMocks();
  Object.keys(registeredRoutes).forEach((k) => delete registeredRoutes[k]);
  fastify = createFastifyInstance();
  const { default: rateLimitsPlugin } = await import(
    "../../src/routes/rateLimits.js"
  );
  await rateLimitsPlugin(fastify, {});
});

describe("GET /status", () => {
  it("returns rate limit status for authenticated user", async () => {
    const mockStatus = { allowed: true, remaining: 95, resetAt: Date.now() + 60000 };
    vi.mocked(checkRateLimit).mockResolvedValue(mockStatus as any);

    const handler = registeredRoutes["GET /status"]?.handler;
    expect(handler).toBeDefined();

    const req = makeReq({ userId: 42 });
    const reply = makeReply();
    const result = await handler(req, reply);

    expect(checkRateLimit).toHaveBeenCalledWith(42);
    expect(result).toEqual(mockStatus);
  });

  it("passes correct userId from request", async () => {
    vi.mocked(checkRateLimit).mockResolvedValue({ allowed: true } as any);

    const handler = registeredRoutes["GET /status"]?.handler;
    const req = makeReq({ userId: 99 });
    await handler(req, makeReply());

    expect(checkRateLimit).toHaveBeenCalledWith(99);
  });
});

describe("GET /tiers", () => {
  it("returns list of all tiers", async () => {
    const tiers = [
      { id: 1, name: "free", requestsPerHour: 10 },
      { id: 2, name: "pro", requestsPerHour: 100 },
    ];
    vi.mocked(listTiers).mockResolvedValue(tiers as any);

    const handler = registeredRoutes["GET /tiers"]?.handler;
    expect(handler).toBeDefined();

    const result = await handler(makeReq(), makeReply());

    expect(listTiers).toHaveBeenCalled();
    expect(result).toEqual({ tiers });
  });

  it("returns empty array when no tiers exist", async () => {
    vi.mocked(listTiers).mockResolvedValue([] as any);

    const handler = registeredRoutes["GET /tiers"]?.handler;
    const result = await handler(makeReq(), makeReply());

    expect(result).toEqual({ tiers: [] });
  });
});

describe("POST /tiers", () => {
  it("creates a new tier with name", async () => {
    const newTier = { id: 3, name: "enterprise", requestsPerHour: 1000 };
    vi.mocked(createTier).mockResolvedValue(newTier as any);

    const handler = registeredRoutes["POST /tiers"]?.handler;
    expect(handler).toBeDefined();

    const req = makeReq({ body: { name: "enterprise", requestsPerHour: 1000 } });
    const reply = makeReply();
    const result = await handler(req, reply);

    expect(createTier).toHaveBeenCalledWith(
      expect.objectContaining({ name: "enterprise" })
    );
    expect(result).toEqual(newTier);
  });

  it("returns 400 when name is missing", async () => {
    const handler = registeredRoutes["POST /tiers"]?.handler;
    const req = makeReq({ body: { requestsPerHour: 100 } });
    const reply = makeReply();
    await handler(req, reply);

    expect(reply.code).toHaveBeenCalledWith(400);
    expect(createTier).not.toHaveBeenCalled();
  });
});

describe("PUT /tiers/:id", () => {
  it("updates an existing tier", async () => {
    const updated = { id: 1, name: "free-updated", requestsPerHour: 20 };
    vi.mocked(updateTier).mockResolvedValue(updated as any);

    const handler = registeredRoutes["PUT /tiers/:id"]?.handler;
    expect(handler).toBeDefined();

    const req = makeReq({
      params: { id: "1" },
      body: { name: "free-updated", requestsPerHour: 20 },
    });
    const reply = makeReply();
    const result = await handler(req, reply);

    expect(updateTier).toHaveBeenCalledWith(1, expect.objectContaining({ name: "free-updated" }));
    expect(result).toEqual(updated);
  });

  it("returns 404 when tier not found", async () => {
    vi.mocked(updateTier).mockResolvedValue(null as any);

    const handler = registeredRoutes["PUT /tiers/:id"]?.handler;
    const req = makeReq({ params: { id: "999" }, body: { name: "ghost" } });
    const reply = makeReply();
    await handler(req, reply);

    expect(reply.code).toHaveBeenCalledWith(404);
  });
});

describe("DELETE /tiers/:id", () => {
  it("deletes an existing tier and returns 204", async () => {
    vi.mocked(deleteTier).mockResolvedValue(true as any);

    const handler = registeredRoutes["DELETE /tiers/:id"]?.handler;
    expect(handler).toBeDefined();

    const req = makeReq({ params: { id: "1" } });
    const reply = makeReply();
    await handler(req, reply);

    expect(deleteTier).toHaveBeenCalledWith(1);
    expect(reply.code).toHaveBeenCalledWith(204);
  });

  it("returns 404 when tier not found", async () => {
    vi.mocked(deleteTier).mockResolvedValue(false as any);

    const handler = registeredRoutes["DELETE /tiers/:id"]?.handler;
    const req = makeReq({ params: { id: "999" } });
    const reply = makeReply();
    const result = await handler(req, reply);

    expect(reply.code).toHaveBeenCalledWith(404);
    expect(result).toMatchObject({ error: expect.any(String) });
  });
});

describe("PUT /users/:userId", () => {
  it("sets tier for a user", async () => {
    const result = { userId: 5, tierId: 2 };
    vi.mocked(setUserTier).mockResolvedValue(result as any);

    const handler = registeredRoutes["PUT /users/:userId"]?.handler;
    expect(handler).toBeDefined();

    const req = makeReq({ params: { userId: "5" }, body: { tierId: 2 } });
    const reply = makeReply();
    const res = await handler(req, reply);

    expect(setUserTier).toHaveBeenCalledWith(5, 2);
    expect(res).toEqual({ ok: true });
  });

  it("passes tierId from body to service", async () => {
    vi.mocked(setUserTier).mockResolvedValue({} as any);

    const handler = registeredRoutes["PUT /users/:userId"]?.handler;
    const req = makeReq({ params: { userId: "10" }, body: { tierId: 3 } });
    await handler(req, makeReply());

    expect(setUserTier).toHaveBeenCalledWith(10, 3);
  });
});

describe("DELETE /users/:userId", () => {
  it("removes tier from a user", async () => {
    vi.mocked(removeUserTier).mockResolvedValue(undefined as any);

    const handler = registeredRoutes["DELETE /users/:userId"]?.handler;
    expect(handler).toBeDefined();

    const req = makeReq({ params: { userId: "5" } });
    const reply = makeReply();
    await handler(req, reply);

    expect(removeUserTier).toHaveBeenCalledWith(5);
  });
});

describe("PUT /groups/:groupId", () => {
  it("sets tier for a group", async () => {
    const result = { groupId: 7, tierId: 1 };
    vi.mocked(setGroupTier).mockResolvedValue(result as any);

    const handler = registeredRoutes["PUT /groups/:groupId"]?.handler;
    expect(handler).toBeDefined();

    const req = makeReq({ params: { groupId: "7" }, body: { tierId: 1 } });
    const reply = makeReply();
    const res = await handler(req, reply);

    expect(setGroupTier).toHaveBeenCalledWith(7, 1);
    expect(res).toEqual({ ok: true });
  });
});

describe("DELETE /groups/:groupId", () => {
  it("removes tier from a group", async () => {
    vi.mocked(removeGroupTier).mockResolvedValue(undefined as any);

    const handler = registeredRoutes["DELETE /groups/:groupId"]?.handler;
    expect(handler).toBeDefined();

    const req = makeReq({ params: { groupId: "7" } });
    const reply = makeReply();
    await handler(req, reply);

    expect(removeGroupTier).toHaveBeenCalledWith(7);
  });
});

describe("route registration", () => {
  it("registers GET /status route", () => {
    expect(registeredRoutes["GET /status"]).toBeDefined();
  });

  it("registers GET /tiers route", () => {
    expect(registeredRoutes["GET /tiers"]).toBeDefined();
  });

  it("registers POST /tiers route", () => {
    expect(registeredRoutes["POST /tiers"]).toBeDefined();
  });

  it("registers PUT /tiers/:id route", () => {
    expect(registeredRoutes["PUT /tiers/:id"]).toBeDefined();
  });

  it("registers DELETE /tiers/:id route", () => {
    expect(registeredRoutes["DELETE /tiers/:id"]).toBeDefined();
  });

  it("registers PUT /users/:userId route", () => {
    expect(registeredRoutes["PUT /users/:userId"]).toBeDefined();
  });

  it("registers DELETE /users/:userId route", () => {
    expect(registeredRoutes["DELETE /users/:userId"]).toBeDefined();
  });

  it("registers PUT /groups/:groupId route", () => {
    expect(registeredRoutes["PUT /groups/:groupId"]).toBeDefined();
  });

  it("registers DELETE /groups/:groupId route", () => {
    expect(registeredRoutes["DELETE /groups/:groupId"]).toBeDefined();
  });
});
