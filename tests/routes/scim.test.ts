import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  mockScimCreateUser,
  mockScimGetUser,
  mockScimListUsers,
  mockScimUpdateUser,
  mockScimPatchUser,
  mockScimDeleteUser,
  mockScimError,
} = vi.hoisted(() => ({
  mockScimCreateUser: vi.fn(),
  mockScimGetUser: vi.fn(),
  mockScimListUsers: vi.fn(),
  mockScimUpdateUser: vi.fn(),
  mockScimPatchUser: vi.fn(),
  mockScimDeleteUser: vi.fn(),
  mockScimError: vi.fn((status: number, msg: string) => ({ status, detail: msg, schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"] })),
}));

vi.mock("../../src/services/scim.service.js", () => ({
  scimCreateUser: mockScimCreateUser,
  scimGetUser: mockScimGetUser,
  scimListUsers: mockScimListUsers,
  scimUpdateUser: mockScimUpdateUser,
  scimPatchUser: mockScimPatchUser,
  scimDeleteUser: mockScimDeleteUser,
  scimError: mockScimError,
}));

// Mock db to return a valid scim token
const mockDbSelectLimit = vi.fn().mockResolvedValue([{
  id: 1,
  tokenHash: "hash",
  active: true,
  expiresAt: null,
}]);
const mockDbSelect = vi.fn().mockReturnValue({
  from: vi.fn().mockReturnValue({
    where: vi.fn().mockReturnValue({
      limit: mockDbSelectLimit,
    }),
  }),
});
const mockDbUpdate = vi.fn().mockReturnValue({
  set: vi.fn().mockReturnValue({
    where: vi.fn().mockReturnValue({
      catch: vi.fn(),
    }),
  }),
});

vi.mock("../../src/lib/drizzle.js", () => ({
  db: {
    get select() { return mockDbSelect; },
    get update() { return mockDbUpdate; },
  },
}));

vi.mock("../../src/db/schema/scim.js", () => ({
  scimTokens: {
    id: "id",
    tokenHash: "tokenHash",
    active: "active",
    expiresAt: "expiresAt",
    lastUsedAt: "lastUsedAt",
  },
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((a, b) => ({ eq: true, a, b })),
  and: vi.fn((...args) => ({ and: true, args })),
}));

vi.mock("node:crypto", () => ({
  createHash: vi.fn().mockReturnValue({
    update: vi.fn().mockReturnValue({
      digest: vi.fn().mockReturnValue("hash"),
    }),
  }),
  timingSafeEqual: vi.fn().mockReturnValue(true),
}));

const registeredRoutes: Record<string, { handler: Function; hooks?: Function[] }> = {};
const registeredHooks: { name: string; handler: Function }[] = [];

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
    addHook: vi.fn((name: string, fn: Function) => {
      registeredHooks.push({ name, fn } as any);
    }),
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
    headers: { authorization: "Bearer test-token" },
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

import scimPlugin from "../../src/routes/scim.js";

describe("scim routes", () => {
  let fastify: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    Object.keys(registeredRoutes).forEach((k) => delete registeredRoutes[k]);
    registeredHooks.length = 0;
    fastify = createFastifyInstance();

    // Reset db mock to return valid token
    mockDbSelectLimit.mockResolvedValue([{
      id: 1,
      tokenHash: "hash",
      active: true,
      expiresAt: null,
    }]);
    mockDbSelect.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: mockDbSelectLimit,
        }),
      }),
    });
    mockDbUpdate.mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          catch: vi.fn(),
        }),
      }),
    });

    await scimPlugin(fastify);
  });

  describe("GET /ServiceProviderConfig", () => {
    it("registers GET /ServiceProviderConfig route", () => {
      expect(registeredRoutes["GET /ServiceProviderConfig"]).toBeDefined();
    });

    it("returns SCIM service provider config", async () => {
      const handler = registeredRoutes["GET /ServiceProviderConfig"].handler;
      const result = await handler(makeReq(), makeReply());

      expect(result).toHaveProperty("schemas");
      expect(result.schemas).toContain("urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig");
      expect(result).toHaveProperty("patch");
      expect(result.patch.supported).toBe(true);
    });

    it("includes authenticationSchemes", async () => {
      const handler = registeredRoutes["GET /ServiceProviderConfig"].handler;
      const result = await handler(makeReq(), makeReply());

      expect(result).toHaveProperty("authenticationSchemes");
      expect(Array.isArray(result.authenticationSchemes)).toBe(true);
    });
  });

  describe("GET /Schemas", () => {
    it("registers GET /Schemas route", () => {
      expect(registeredRoutes["GET /Schemas"]).toBeDefined();
    });

    it("returns schemas list with User schema", async () => {
      const handler = registeredRoutes["GET /Schemas"].handler;
      const result = await handler(makeReq(), makeReply());

      expect(result).toHaveProperty("schemas");
      expect(result).toHaveProperty("Resources");
      expect(result.Resources[0].id).toContain("User");
    });

    it("includes totalResults", async () => {
      const handler = registeredRoutes["GET /Schemas"].handler;
      const result = await handler(makeReq(), makeReply());

      expect(result).toHaveProperty("totalResults");
    });
  });

  describe("GET /ResourceTypes", () => {
    it("registers GET /ResourceTypes route", () => {
      expect(registeredRoutes["GET /ResourceTypes"]).toBeDefined();
    });

    it("returns resource types with User type", async () => {
      const handler = registeredRoutes["GET /ResourceTypes"].handler;
      const result = await handler(makeReq(), makeReply());

      expect(result).toHaveProperty("Resources");
      expect(result.Resources[0].name).toBe("User");
      expect(result.Resources[0].endpoint).toBe("/Users");
    });
  });

  describe("POST /Users", () => {
    it("registers POST /Users route", () => {
      expect(registeredRoutes["POST /Users"]).toBeDefined();
    });

    it("creates a user with valid data", async () => {
      const createdUser = { id: "1", userName: "john.doe@example.com", schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"] };
      mockScimCreateUser.mockResolvedValue(createdUser);

      const handler = registeredRoutes["POST /Users"].handler;
      const req = makeReq({
        body: {
          schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"],
          userName: "john.doe@example.com",
          emails: [{ value: "john.doe@example.com", primary: true }],
        },
      });
      const reply = makeReply();

      const result = await handler(req, reply);

      expect(mockScimCreateUser).toHaveBeenCalled();
      expect(reply.code).toHaveBeenCalledWith(201);
      expect(result).toEqual(createdUser);
    });

    it("returns 400 when userName and emails are missing", async () => {
      const handler = registeredRoutes["POST /Users"].handler;
      const req = makeReq({ body: { schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"] } });
      const reply = makeReply();

      const result = await handler(req, reply);

      expect(reply.code).toHaveBeenCalledWith(400);
      expect(mockScimCreateUser).not.toHaveBeenCalled();
    });

    it("calls scimCreateUser with request body", async () => {
      mockScimCreateUser.mockResolvedValue({ id: "1", userName: "test" });
      const handler = registeredRoutes["POST /Users"].handler;
      const scimUser = { userName: "test@example.com", active: true };
      const req = makeReq({ body: scimUser });
      const reply = makeReply();

      await handler(req, reply);

      expect(mockScimCreateUser).toHaveBeenCalledWith(scimUser);
    });
  });

  describe("GET /Users", () => {
    it("registers GET /Users route", () => {
      expect(registeredRoutes["GET /Users"]).toBeDefined();
    });

    it("returns list of users", async () => {
      const listResponse = {
        schemas: ["urn:ietf:params:scim:api:messages:2.0:ListResponse"],
        totalResults: 1,
        Resources: [{ id: "1", userName: "test@example.com" }],
      };
      mockScimListUsers.mockResolvedValue(listResponse);

      const handler = registeredRoutes["GET /Users"].handler;
      const req = makeReq({ query: {} });
      const reply = makeReply();

      const result = await handler(req, reply);

      expect(mockScimListUsers).toHaveBeenCalled();
      expect(result).toEqual(listResponse);
    });

    it("passes startIndex and count to scimListUsers", async () => {
      mockScimListUsers.mockResolvedValue({ Resources: [] });
      const handler = registeredRoutes["GET /Users"].handler;
      const req = makeReq({ query: { startIndex: "5", count: "20" } });
      const reply = makeReply();

      await handler(req, reply);

      expect(mockScimListUsers).toHaveBeenCalledWith(5, 20, undefined);
    });

    it("passes filter to scimListUsers", async () => {
      mockScimListUsers.mockResolvedValue({ Resources: [] });
      const handler = registeredRoutes["GET /Users"].handler;
      const req = makeReq({ query: { filter: 'userName eq "test"' } });
      const reply = makeReply();

      await handler(req, reply);

      expect(mockScimListUsers).toHaveBeenCalledWith(
        expect.any(Number),
        expect.any(Number),
        'userName eq "test"'
      );
    });
  });

  describe("GET /Users/:id", () => {
    it("registers GET /Users/:id route", () => {
      expect(registeredRoutes["GET /Users/:id"]).toBeDefined();
    });

    it("returns user for valid id", async () => {
      const user = { id: "42", userName: "jane@example.com" };
      mockScimGetUser.mockResolvedValue(user);

      const handler = registeredRoutes["GET /Users/:id"].handler;
      const req = makeReq({ params: { id: "42" } });
      const reply = makeReply();

      const result = await handler(req, reply);

      expect(mockScimGetUser).toHaveBeenCalledWith(42);
      expect(result).toEqual(user);
    });

    it("returns 404 when user not found", async () => {
      mockScimGetUser.mockResolvedValue(null);

      const handler = registeredRoutes["GET /Users/:id"].handler;
      const req = makeReq({ params: { id: "999" } });
      const reply = makeReply();

      const result = await handler(req, reply);

      expect(reply.code).toHaveBeenCalledWith(404);
      expect(mockScimError).toHaveBeenCalledWith(404, expect.stringContaining("999"));
    });
  });

  describe("PUT /Users/:id", () => {
    it("registers PUT /Users/:id route", () => {
      expect(registeredRoutes["PUT /Users/:id"]).toBeDefined();
    });

    it("updates a user with valid data", async () => {
      const updatedUser = { id: "1", userName: "updated@example.com" };
      mockScimUpdateUser.mockResolvedValue(updatedUser);

      const handler = registeredRoutes["PUT /Users/:id"].handler;
      const req = makeReq({
        params: { id: "1" },
        body: { userName: "updated@example.com" },
      });
      const reply = makeReply();

      const result = await handler(req, reply);

      expect(mockScimUpdateUser).toHaveBeenCalledWith(1, expect.objectContaining({ userName: "updated@example.com" }));
      expect(result).toEqual(updatedUser);
    });

    it("returns 404 when update throws error", async () => {
      mockScimUpdateUser.mockRejectedValue(new Error("Not found"));

      const handler = registeredRoutes["PUT /Users/:id"].handler;
      const req = makeReq({
        params: { id: "999" },
        body: { userName: "test@example.com" },
      });
      const reply = makeReply();

      await handler(req, reply);

      expect(reply.code).toHaveBeenCalledWith(404);
    });
  });

  describe("PATCH /Users/:id", () => {
    it("registers PATCH /Users/:id route", () => {
      expect(registeredRoutes["PATCH /Users/:id"]).toBeDefined();
    });

    it("patches a user with valid operation", async () => {
      const patchedUser = { id: "1", userName: "test@example.com", active: false };
      mockScimPatchUser.mockResolvedValue(patchedUser);

      const handler = registeredRoutes["PATCH /Users/:id"].handler;
      const req = makeReq({
        params: { id: "1" },
        body: {
          schemas: ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
          Operations: [{ op: "replace", path: "active", value: false }],
        },
      });
      const reply = makeReply();

      const result = await handler(req, reply);

      expect(mockScimPatchUser).toHaveBeenCalledWith(1, expect.any(Object));
      expect(result).toEqual(patchedUser);
    });

    it("returns 404 when patch throws error", async () => {
      mockScimPatchUser.mockRejectedValue(new Error("Not found"));

      const handler = registeredRoutes["PATCH /Users/:id"].handler;
      const req = makeReq({
        params: { id: "999" },
        body: { Operations: [] },
      });
      const reply = makeReply();

      await handler(req, reply);

      expect(reply.code).toHaveBeenCalledWith(404);
    });
  });

  describe("DELETE /Users/:id", () => {
    it("registers DELETE /Users/:id route", () => {
      expect(registeredRoutes["DELETE /Users/:id"]).toBeDefined();
    });

    it("deletes a user and returns 204", async () => {
      mockScimDeleteUser.mockResolvedValue(undefined);

      const handler = registeredRoutes["DELETE /Users/:id"].handler;
      const req = makeReq({ params: { id: "1" } });
      const reply = makeReply();

      await handler(req, reply);

      expect(mockScimDeleteUser).toHaveBeenCalledWith(1);
      expect(reply.code).toHaveBeenCalledWith(204);
    });

    it("calls scimDeleteUser with numeric id", async () => {
      mockScimDeleteUser.mockResolvedValue(undefined);

      const handler = registeredRoutes["DELETE /Users/:id"].handler;
      const req = makeReq({ params: { id: "42" } });
      const reply = makeReply();

      await handler(req, reply);

      expect(mockScimDeleteUser).toHaveBeenCalledWith(42);
    });
  });

  describe("Authentication hook", () => {
    it("adds onRequest hook for auth", () => {
      expect(fastify.addHook).toHaveBeenCalledWith("onRequest", expect.any(Function));
    });

    it("returns 401 when no authorization header", async () => {
      // Get the onRequest hook
      const onRequestCall = (fastify.addHook as any).mock.calls.find(
        (call: any[]) => call[0] === "onRequest"
      );
      expect(onRequestCall).toBeDefined();
      const authHook = onRequestCall[1];

      const req = makeReq({ headers: {} });
      const reply = makeReply();

      await authHook(req, reply);

      expect(reply.code).toHaveBeenCalledWith(401);
    });

    it("returns 401 when token not found in db", async () => {
      mockDbSelectLimit.mockResolvedValue([]);

      const onRequestCall = (fastify.addHook as any).mock.calls.find(
        (call: any[]) => call[0] === "onRequest"
      );
      const authHook = onRequestCall[1];

      const req = makeReq({ headers: { authorization: "Bearer invalid-token" } });
      const reply = makeReply();

      await authHook(req, reply);

      expect(reply.code).toHaveBeenCalledWith(401);
    });

    it("returns 401 for expired token", async () => {
      const pastDate = new Date(Date.now() - 1000);
      mockDbSelectLimit.mockResolvedValue([{
        id: 1,
        tokenHash: "hash",
        active: true,
        expiresAt: pastDate,
      }]);

      const onRequestCall = (fastify.addHook as any).mock.calls.find(
        (call: any[]) => call[0] === "onRequest"
      );
      const authHook = onRequestCall[1];

      const req = makeReq({ headers: { authorization: "Bearer expired-token" } });
      const reply = makeReply();

      await authHook(req, reply);

      expect(reply.code).toHaveBeenCalledWith(401);
    });
  });
});
