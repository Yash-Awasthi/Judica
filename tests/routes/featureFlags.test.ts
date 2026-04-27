import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/middleware/fastifyAuth.js", () => ({
  fastifyRequireAuth: vi.fn(),
  fastifyRequireAdmin: vi.fn(),
}));

vi.mock("../../src/services/featureFlag.service.js", () => ({
  evaluateAllFlags: vi.fn(),
  evaluateFlag: vi.fn(),
  listFlags: vi.fn(),
  createFlag: vi.fn(),
  updateFlag: vi.fn(),
  deleteFlag: vi.fn(),
  setUserOverride: vi.fn(),
  removeUserOverride: vi.fn(),
}));

import {
  evaluateAllFlags,
  evaluateFlag,
  listFlags,
  createFlag,
  updateFlag,
  deleteFlag,
  setUserOverride,
  removeUserOverride,
} from "../../src/services/featureFlag.service.js";

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
  const { default: featureFlagsPlugin } = await import(
    "../../src/routes/featureFlags.js"
  );
  await featureFlagsPlugin(fastify, {});
});

describe("GET /", () => {
  it("evaluates all flags for authenticated user", async () => {
    const flags = { dark_mode: true, new_dashboard: false };
    vi.mocked(evaluateAllFlags).mockResolvedValue(flags as any);

    const handler = registeredRoutes["GET /"]?.handler;
    expect(handler).toBeDefined();

    const req = makeReq({ userId: 5 });
    const reply = makeReply();
    const result = await handler(req, reply);

    expect(evaluateAllFlags).toHaveBeenCalledWith(5);
    expect(result).toEqual(flags);
  });

  it("passes userId from request to evaluateAllFlags", async () => {
    vi.mocked(evaluateAllFlags).mockResolvedValue({} as any);

    const handler = registeredRoutes["GET /"]?.handler;
    const req = makeReq({ userId: 77 });
    await handler(req, makeReply());

    expect(evaluateAllFlags).toHaveBeenCalledWith(77);
  });
});

describe("GET /evaluate/:key", () => {
  it("evaluates a specific feature flag by key", async () => {
    vi.mocked(evaluateFlag).mockResolvedValue(true as any);

    const handler = registeredRoutes["GET /evaluate/:key"]?.handler;
    expect(handler).toBeDefined();

    const req = makeReq({ userId: 3, params: { key: "dark_mode" } });
    const reply = makeReply();
    const result = await handler(req, reply);

    expect(evaluateFlag).toHaveBeenCalledWith("dark_mode", 3);
    expect(result).toBe(true);
  });

  it("returns false when flag is disabled for user", async () => {
    vi.mocked(evaluateFlag).mockResolvedValue(false as any);

    const handler = registeredRoutes["GET /evaluate/:key"]?.handler;
    const req = makeReq({ userId: 3, params: { key: "beta_feature" } });
    const result = await handler(req, makeReply());

    expect(result).toBe(false);
  });
});

describe("GET /admin/flags", () => {
  it("lists all flags for admin", async () => {
    const flags = [
      { id: 1, key: "dark_mode", name: "Dark Mode", enabled: true },
      { id: 2, key: "new_dashboard", name: "New Dashboard", enabled: false },
    ];
    vi.mocked(listFlags).mockResolvedValue(flags as any);

    const handler = registeredRoutes["GET /admin/flags"]?.handler;
    expect(handler).toBeDefined();

    const result = await handler(makeReq({ role: "admin" }), makeReply());

    expect(listFlags).toHaveBeenCalled();
    expect(result).toEqual({ flags });
  });

  it("returns empty array when no flags exist", async () => {
    vi.mocked(listFlags).mockResolvedValue([] as any);

    const handler = registeredRoutes["GET /admin/flags"]?.handler;
    const result = await handler(makeReq({ role: "admin" }), makeReply());

    expect(result).toEqual({ flags: [] });
  });
});

describe("POST /admin/flags", () => {
  it("creates a flag with key and name", async () => {
    const created = { id: 3, key: "new_feature", name: "New Feature", enabled: false };
    vi.mocked(createFlag).mockResolvedValue(created as any);

    const handler = registeredRoutes["POST /admin/flags"]?.handler;
    expect(handler).toBeDefined();

    const req = makeReq({
      role: "admin",
      body: { key: "new_feature", name: "New Feature" },
    });
    const reply = makeReply();
    const result = await handler(req, reply);

    expect(createFlag).toHaveBeenCalledWith(
      expect.objectContaining({ key: "new_feature", name: "New Feature" })
    );
    expect(result).toEqual(created);
  });

  it("returns 400 when key is missing", async () => {
    const handler = registeredRoutes["POST /admin/flags"]?.handler;
    const req = makeReq({ role: "admin", body: { name: "New Feature" } });
    const reply = makeReply();
    await handler(req, reply);

    expect(reply.code).toHaveBeenCalledWith(400);
    expect(createFlag).not.toHaveBeenCalled();
  });

  it("returns 400 when name is missing", async () => {
    const handler = registeredRoutes["POST /admin/flags"]?.handler;
    const req = makeReq({ role: "admin", body: { key: "new_feature" } });
    const reply = makeReply();
    await handler(req, reply);

    expect(reply.code).toHaveBeenCalledWith(400);
    expect(createFlag).not.toHaveBeenCalled();
  });
});

describe("PUT /admin/flags/:id", () => {
  it("updates an existing feature flag", async () => {
    const updated = { id: 1, key: "dark_mode", name: "Dark Mode", enabled: false };
    vi.mocked(updateFlag).mockResolvedValue(updated as any);

    const handler = registeredRoutes["PUT /admin/flags/:id"]?.handler;
    expect(handler).toBeDefined();

    const req = makeReq({
      role: "admin",
      params: { id: "1" },
      body: { enabled: false },
    });
    const reply = makeReply();
    const result = await handler(req, reply);

    expect(updateFlag).toHaveBeenCalledWith(1, expect.objectContaining({ enabled: false }));
    expect(result).toEqual(updated);
  });

  it("returns 404 when flag not found", async () => {
    vi.mocked(updateFlag).mockResolvedValue(null as any);

    const handler = registeredRoutes["PUT /admin/flags/:id"]?.handler;
    const req = makeReq({ role: "admin", params: { id: "999" }, body: { enabled: true } });
    const reply = makeReply();
    await handler(req, reply);

    expect(reply.code).toHaveBeenCalledWith(404);
  });
});

describe("DELETE /admin/flags/:id", () => {
  it("deletes a flag and returns 204", async () => {
    vi.mocked(deleteFlag).mockResolvedValue(true as any);

    const handler = registeredRoutes["DELETE /admin/flags/:id"]?.handler;
    expect(handler).toBeDefined();

    const req = makeReq({ role: "admin", params: { id: "1" } });
    const reply = makeReply();
    await handler(req, reply);

    expect(deleteFlag).toHaveBeenCalledWith(1);
    expect(reply.code).toHaveBeenCalledWith(204);
  });

  it("passes correct id to deleteFlag", async () => {
    vi.mocked(deleteFlag).mockResolvedValue(true as any);

    const handler = registeredRoutes["DELETE /admin/flags/:id"]?.handler;
    const req = makeReq({ role: "admin", params: { id: "42" } });
    await handler(req, makeReply());

    expect(deleteFlag).toHaveBeenCalledWith(42);
  });
});

describe("PUT /admin/flags/:id/users/:userId", () => {
  it("sets user override for a flag", async () => {
    const result = { flagId: 1, userId: 5, value: true };
    vi.mocked(setUserOverride).mockResolvedValue(result as any);

    const handler = registeredRoutes["PUT /admin/flags/:id/users/:userId"]?.handler;
    expect(handler).toBeDefined();

    const req = makeReq({
      role: "admin",
      params: { id: "1", userId: "5" },
      body: { enabled: true },
    });
    const reply = makeReply();
    const res = await handler(req, reply);

    expect(setUserOverride).toHaveBeenCalledWith(1, 5, true, undefined);
    expect(res).toEqual({ ok: true });
  });

  it("sets user override to false", async () => {
    vi.mocked(setUserOverride).mockResolvedValue({} as any);

    const handler = registeredRoutes["PUT /admin/flags/:id/users/:userId"]?.handler;
    const req = makeReq({
      role: "admin",
      params: { id: "2", userId: "10" },
      body: { enabled: false },
    });
    await handler(req, makeReply());

    expect(setUserOverride).toHaveBeenCalledWith(2, 10, false, undefined);
  });
});

describe("DELETE /admin/flags/:id/users/:userId", () => {
  it("removes user override for a flag", async () => {
    vi.mocked(removeUserOverride).mockResolvedValue(undefined as any);

    const handler = registeredRoutes["DELETE /admin/flags/:id/users/:userId"]?.handler;
    expect(handler).toBeDefined();

    const req = makeReq({
      role: "admin",
      params: { id: "1", userId: "5" },
    });
    const reply = makeReply();
    await handler(req, reply);

    expect(removeUserOverride).toHaveBeenCalledWith(1, 5);
  });

  it("passes correct ids to removeUserOverride", async () => {
    vi.mocked(removeUserOverride).mockResolvedValue(undefined as any);

    const handler = registeredRoutes["DELETE /admin/flags/:id/users/:userId"]?.handler;
    const req = makeReq({
      role: "admin",
      params: { id: "7", userId: "99" },
    });
    await handler(req, makeReply());

    expect(removeUserOverride).toHaveBeenCalledWith(7, 99);
  });
});

describe("route registration", () => {
  it("registers GET / route", () => {
    expect(registeredRoutes["GET /"]).toBeDefined();
  });

  it("registers GET /evaluate/:key route", () => {
    expect(registeredRoutes["GET /evaluate/:key"]).toBeDefined();
  });

  it("registers GET /admin/flags route", () => {
    expect(registeredRoutes["GET /admin/flags"]).toBeDefined();
  });

  it("registers POST /admin/flags route", () => {
    expect(registeredRoutes["POST /admin/flags"]).toBeDefined();
  });

  it("registers PUT /admin/flags/:id route", () => {
    expect(registeredRoutes["PUT /admin/flags/:id"]).toBeDefined();
  });

  it("registers DELETE /admin/flags/:id route", () => {
    expect(registeredRoutes["DELETE /admin/flags/:id"]).toBeDefined();
  });

  it("registers PUT /admin/flags/:id/users/:userId route", () => {
    expect(registeredRoutes["PUT /admin/flags/:id/users/:userId"]).toBeDefined();
  });

  it("registers DELETE /admin/flags/:id/users/:userId route", () => {
    expect(registeredRoutes["DELETE /admin/flags/:id/users/:userId"]).toBeDefined();
  });
});
