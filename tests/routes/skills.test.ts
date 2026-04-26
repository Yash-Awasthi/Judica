import { describe, it, expect, vi, beforeEach } from "vitest";

// ---- mocks ----

const mockDb: any = {};

function chainable(overrides: Record<string, any> = {}): any {
  const chain: any = {};
  const methods = [
    "select",
    "from",
    "where",
    "limit",
    "orderBy",
    "update",
    "set",
    "insert",
    "values",
    "returning",
    "delete",
  ];
  for (const m of methods) {
    chain[m] = overrides[m] ?? vi.fn(() => chain);
  }
  return chain;
}

vi.mock("../../src/lib/drizzle.js", () => ({
  db: mockDb,
}));

vi.mock("../../src/db/schema/marketplace.js", () => ({
  userSkills: {
    id: "userSkills.id",
    userId: "userSkills.userId",
    name: "userSkills.name",
    description: "userSkills.description",
    code: "userSkills.code",
    parameters: "userSkills.parameters",
    active: "userSkills.active",
    createdAt: "userSkills.createdAt",
  },
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((...args: any[]) => args),
  and: vi.fn((...args: any[]) => args),
  desc: vi.fn((col: any) => col),
  relations: vi.fn(() => ({})),
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

const mockExecuteUserSkill = vi.fn();
vi.mock("../../src/lib/tools/skillExecutor.js", () => ({
  executeUserSkill: (...args: any[]) => mockExecuteUserSkill(...args),
}));

vi.mock("crypto", async () => {
  const actual = await vi.importActual<typeof import("crypto")>("crypto");
  let callCount = 0;
  return {
    ...actual,
    randomUUID: vi.fn(() => {
      callCount++;
      return `mock-uuid-${callCount}`;
    }),
  };
});

// ---- helpers to capture registered route handlers ----

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
  };
}

function createRequest(overrides: Partial<{ userId: string; body: any; params: any; headers: Record<string, string> }> = {}): any {
  return {
    userId: overrides.userId ?? "user-1",
    body: overrides.body ?? {},
    params: overrides.params ?? {},
    headers: overrides.headers ?? { authorization: "Bearer token" },
  };
}

function createReply(): any {
  const reply: any = {
    statusCode: 200,
    code: vi.fn(function (this: any, c: number) {
      this.statusCode = c;
      return this;
    }),
    send: vi.fn(function (this: any) {
      return this;
    }),
  };
  return reply;
}

// ---- import and register the plugin ----

let skillsPlugin: any;

beforeEach(async () => {
  vi.clearAllMocks();
  for (const key of Object.keys(registeredRoutes)) {
    delete registeredRoutes[key];
  }

  const mod = await import("../../src/routes/skills.js");
  skillsPlugin = mod.default;
  const fastify = createFastifyInstance();
  await skillsPlugin(fastify);
});

// ================================================================
// Route registration
// ================================================================
describe("route registration", () => {
  it("registers all expected routes", () => {
    expect(registeredRoutes["GET /"]).toBeDefined();
    expect(registeredRoutes["POST /"]).toBeDefined();
    expect(registeredRoutes["PUT /:id"]).toBeDefined();
    expect(registeredRoutes["DELETE /:id"]).toBeDefined();
    expect(registeredRoutes["POST /:id/test"]).toBeDefined();
  });

  it("all routes have a preHandler for auth", () => {
    for (const key of Object.keys(registeredRoutes)) {
      expect(registeredRoutes[key].preHandler).toBeDefined();
    }
  });
});

// ================================================================
// GET / — list user's skills
// ================================================================
describe("GET /", () => {
  it("returns list of skills for the authenticated user", async () => {
    const mockSkills = [
      { id: "s1", userId: "user-1", name: "Skill A", description: "Does A", code: "code-a", createdAt: new Date() },
      { id: "s2", userId: "user-1", name: "Skill B", description: "Does B", code: "code-b", createdAt: new Date() },
    ];

    const chain = chainable({
      orderBy: vi.fn().mockResolvedValue(mockSkills),
    });
    mockDb.select = vi.fn(() => chain);

    const { handler } = registeredRoutes["GET /"];
    const result = await handler(createRequest(), createReply());

    expect(result).toEqual({ skills: mockSkills });
    expect(mockDb.select).toHaveBeenCalled();
  });

  it("returns empty array when user has no skills", async () => {
    const chain = chainable({
      orderBy: vi.fn().mockResolvedValue([]),
    });
    mockDb.select = vi.fn(() => chain);

    const { handler } = registeredRoutes["GET /"];
    const result = await handler(createRequest(), createReply());

    expect(result).toEqual({ skills: [] });
  });

  it("propagates db errors", async () => {
    const chain = chainable({
      orderBy: vi.fn().mockRejectedValue(new Error("db down")),
    });
    mockDb.select = vi.fn(() => chain);

    const { handler } = registeredRoutes["GET /"];
    await expect(handler(createRequest(), createReply())).rejects.toThrow("db down");
  });
});

// ================================================================
// POST / — create skill
// ================================================================
describe("POST /", () => {
  it("creates a skill successfully and returns 201", async () => {
    const createdSkill = {
      id: "mock-uuid-1",
      userId: "user-1",
      name: "My Skill",
      description: "Does something",
      code: "console.log('hello')",
      parameters: {},
    };

    const chain = chainable({
      returning: vi.fn().mockResolvedValue([createdSkill]),
    });
    mockDb.insert = vi.fn(() => chain);

    const { handler } = registeredRoutes["POST /"];
    const reply = createReply();
    const request = createRequest({
      body: {
        name: "My Skill",
        description: "Does something",
        code: "console.log('hello')",
      },
    });

    const result = await handler(request, reply);
    expect(result).toEqual(createdSkill);
    expect(reply.code).toHaveBeenCalledWith(201);
    expect(mockDb.insert).toHaveBeenCalled();
  });

  it("creates a skill with custom parameters", async () => {
    const params = { input: { type: "string" } };
    const createdSkill = {
      id: "mock-uuid-1",
      userId: "user-1",
      name: "Parameterized",
      description: "Has params",
      code: "code",
      parameters: params,
    };

    const chain = chainable({
      returning: vi.fn().mockResolvedValue([createdSkill]),
    });
    mockDb.insert = vi.fn(() => chain);

    const { handler } = registeredRoutes["POST /"];
    const reply = createReply();
    const request = createRequest({
      body: {
        name: "Parameterized",
        description: "Has params",
        code: "code",
        parameters: params,
      },
    });

    const result = await handler(request, reply);
    expect(result.parameters).toEqual(params);
    expect(reply.code).toHaveBeenCalledWith(201);
  });

  it("defaults parameters to empty object when not provided", async () => {
    const chain = chainable({
      returning: vi.fn().mockResolvedValue([{ id: "mock-uuid-1", parameters: {} }]),
    });
    mockDb.insert = vi.fn(() => chain);

    const valuesCall = chain.values;

    const { handler } = registeredRoutes["POST /"];
    const request = createRequest({
      body: { name: "Test", description: "Desc", code: "code" },
    });
    await handler(request, createReply());

    // Verify values was called with parameters: {}
    expect(valuesCall).toHaveBeenCalledWith(
      expect.objectContaining({ parameters: {} })
    );
  });

  it("trims name and description", async () => {
    const chain = chainable({
      returning: vi.fn().mockResolvedValue([{ id: "mock-uuid-1" }]),
    });
    mockDb.insert = vi.fn(() => chain);
    const valuesCall = chain.values;

    const { handler } = registeredRoutes["POST /"];
    const request = createRequest({
      body: { name: "  Spacey Name  ", description: "  Spacey Desc  ", code: "code" },
    });
    await handler(request, createReply());

    expect(valuesCall).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Spacey Name",
        description: "Spacey Desc",
      })
    );
  });

  it("throws AppError when name is missing", async () => {
    const { handler } = registeredRoutes["POST /"];
    const request = createRequest({
      body: { description: "desc", code: "code" },
    });

    await expect(handler(request, createReply())).rejects.toThrow(
      "name, description, and code are required"
    );
  });

  it("throws AppError when description is missing", async () => {
    const { handler } = registeredRoutes["POST /"];
    const request = createRequest({
      body: { name: "name", code: "code" },
    });

    await expect(handler(request, createReply())).rejects.toThrow(
      "name, description, and code are required"
    );
  });

  it("throws AppError when code is missing", async () => {
    const { handler } = registeredRoutes["POST /"];
    const request = createRequest({
      body: { name: "name", description: "desc" },
    });

    await expect(handler(request, createReply())).rejects.toThrow(
      "name, description, and code are required"
    );
  });

  it("throws AppError when all fields are missing", async () => {
    const { handler } = registeredRoutes["POST /"];
    const request = createRequest({ body: {} });

    await expect(handler(request, createReply())).rejects.toThrow(
      "name, description, and code are required"
    );
  });

  it("throws AppError when name is empty string", async () => {
    const { handler } = registeredRoutes["POST /"];
    const request = createRequest({
      body: { name: "", description: "desc", code: "code" },
    });

    await expect(handler(request, createReply())).rejects.toThrow(
      "name, description, and code are required"
    );
  });

  it("throws AppError when code exceeds 50,000 characters", async () => {
    const { handler } = registeredRoutes["POST /"];
    const request = createRequest({
      body: { name: "name", description: "desc", code: "x".repeat(50_001) },
    });

    await expect(handler(request, createReply())).rejects.toThrow(
      "Code must be a string under 50,000 characters"
    );
  });

  it("accepts code exactly 50,000 characters long", async () => {
    const createdSkill = { id: "mock-uuid-1" };
    const chain = chainable({
      returning: vi.fn().mockResolvedValue([createdSkill]),
    });
    mockDb.insert = vi.fn(() => chain);

    const { handler } = registeredRoutes["POST /"];
    const request = createRequest({
      body: { name: "name", description: "desc", code: "x".repeat(50_000) },
    });

    const result = await handler(request, createReply());
    expect(result).toEqual(createdSkill);
  });

  it("throws AppError when code is not a string", async () => {
    const { handler } = registeredRoutes["POST /"];
    const request = createRequest({
      body: { name: "name", description: "desc", code: 12345 },
    });

    await expect(handler(request, createReply())).rejects.toThrow(
      "Code must be a string under 50,000 characters"
    );
  });

  it("propagates db errors during insert", async () => {
    const chain = chainable({
      returning: vi.fn().mockRejectedValue(new Error("insert failed")),
    });
    mockDb.insert = vi.fn(() => chain);

    const { handler } = registeredRoutes["POST /"];
    const request = createRequest({
      body: { name: "name", description: "desc", code: "code" },
    });

    await expect(handler(request, createReply())).rejects.toThrow("insert failed");
  });
});

// ================================================================
// PUT /:id — update skill (owner only)
// ================================================================
describe("PUT /:id", () => {
  const existingSkill = {
    id: "skill-1",
    userId: "user-1",
    name: "Original",
    description: "Original desc",
    code: "original code",
    parameters: {},
    active: true,
  };

  it("updates a skill successfully", async () => {
    const updatedSkill = { ...existingSkill, name: "Updated" };

    // select to find skill
    const selectChain = chainable({
      where: vi.fn().mockResolvedValue([existingSkill]),
    });
    mockDb.select = vi.fn(() => selectChain);

    // update
    const updateChain = chainable({
      returning: vi.fn().mockResolvedValue([updatedSkill]),
    });
    mockDb.update = vi.fn(() => updateChain);

    const { handler } = registeredRoutes["PUT /:id"];
    const request = createRequest({
      params: { id: "skill-1" },
      body: { name: "Updated" },
    });

    const result = await handler(request, createReply());
    expect(result).toEqual(updatedSkill);
  });

  it("updates multiple fields at once", async () => {
    const updatedSkill = { ...existingSkill, name: "New", description: "New desc", code: "new code", active: false };

    const selectChain = chainable({
      where: vi.fn().mockResolvedValue([existingSkill]),
    });
    mockDb.select = vi.fn(() => selectChain);

    const updateChain = chainable({
      returning: vi.fn().mockResolvedValue([updatedSkill]),
    });
    mockDb.update = vi.fn(() => updateChain);

    const setCall = updateChain.set;

    const { handler } = registeredRoutes["PUT /:id"];
    const request = createRequest({
      params: { id: "skill-1" },
      body: { name: "  New  ", description: "  New desc  ", code: "new code", active: false },
    });

    await handler(request, createReply());
    expect(setCall).toHaveBeenCalledWith(expect.objectContaining({
      name: "New",
      description: "New desc",
      code: "new code",
      active: false,
    }));
  });

  it("updates parameters field", async () => {
    const newParams = { foo: { type: "number" } };
    const selectChain = chainable({
      where: vi.fn().mockResolvedValue([existingSkill]),
    });
    mockDb.select = vi.fn(() => selectChain);

    const updateChain = chainable({
      returning: vi.fn().mockResolvedValue([{ ...existingSkill, parameters: newParams }]),
    });
    mockDb.update = vi.fn(() => updateChain);

    const setCall = updateChain.set;

    const { handler } = registeredRoutes["PUT /:id"];
    const request = createRequest({
      params: { id: "skill-1" },
      body: { parameters: newParams },
    });

    await handler(request, createReply());
    expect(setCall).toHaveBeenCalledWith(expect.objectContaining({ parameters: newParams }));
  });

  it("sends empty update when no fields provided", async () => {
    const selectChain = chainable({
      where: vi.fn().mockResolvedValue([existingSkill]),
    });
    mockDb.select = vi.fn(() => selectChain);

    const updateChain = chainable({
      returning: vi.fn().mockResolvedValue([existingSkill]),
    });
    mockDb.update = vi.fn(() => updateChain);

    const setCall = updateChain.set;

    const { handler } = registeredRoutes["PUT /:id"];
    const request = createRequest({
      params: { id: "skill-1" },
      body: {},
    });

    await handler(request, createReply());
    // updatedAt is always added by the route
    expect(setCall).toHaveBeenCalledWith(expect.not.objectContaining({ name: expect.anything() }));
  });

  it("throws 404 when skill not found", async () => {
    const selectChain = chainable({
      where: vi.fn().mockResolvedValue([]),
    });
    mockDb.select = vi.fn(() => selectChain);

    const { handler } = registeredRoutes["PUT /:id"];
    const request = createRequest({
      params: { id: "nonexistent" },
      body: { name: "New" },
    });

    await expect(handler(request, createReply())).rejects.toThrow("Skill not found");
  });

  it("throws 403 when user is not the skill owner", async () => {
    const otherUserSkill = { ...existingSkill, userId: "user-other" };
    const selectChain = chainable({
      where: vi.fn().mockResolvedValue([otherUserSkill]),
    });
    mockDb.select = vi.fn(() => selectChain);

    const { handler } = registeredRoutes["PUT /:id"];
    const request = createRequest({
      userId: "user-1",
      params: { id: "skill-1" },
      body: { name: "Hacked" },
    });

    await expect(handler(request, createReply())).rejects.toThrow("Not authorized to update this skill");
  });

  it("propagates db errors during select", async () => {
    const selectChain = chainable({
      where: vi.fn().mockRejectedValue(new Error("select failed")),
    });
    mockDb.select = vi.fn(() => selectChain);

    const { handler } = registeredRoutes["PUT /:id"];
    const request = createRequest({ params: { id: "skill-1" }, body: {} });

    await expect(handler(request, createReply())).rejects.toThrow("select failed");
  });

  it("propagates db errors during update", async () => {
    const selectChain = chainable({
      where: vi.fn().mockResolvedValue([existingSkill]),
    });
    mockDb.select = vi.fn(() => selectChain);

    const updateChain = chainable({
      returning: vi.fn().mockRejectedValue(new Error("update failed")),
    });
    mockDb.update = vi.fn(() => updateChain);

    const { handler } = registeredRoutes["PUT /:id"];
    const request = createRequest({
      params: { id: "skill-1" },
      body: { name: "New" },
    });

    await expect(handler(request, createReply())).rejects.toThrow("update failed");
  });
});

// ================================================================
// DELETE /:id — delete skill (owner only)
// ================================================================
describe("DELETE /:id", () => {
  const existingSkill = {
    id: "skill-1",
    userId: "user-1",
    name: "To Delete",
  };

  it("deletes a skill successfully", async () => {
    const selectChain = chainable({
      where: vi.fn().mockResolvedValue([existingSkill]),
    });
    mockDb.select = vi.fn(() => selectChain);

    const deleteChain = chainable({
      where: vi.fn().mockResolvedValue(undefined),
    });
    mockDb.delete = vi.fn(() => deleteChain);

    const { handler } = registeredRoutes["DELETE /:id"];
    const request = createRequest({ params: { id: "skill-1" } });
    const result = await handler(request, createReply());

    expect(result).toEqual({ success: true });
    expect(mockDb.delete).toHaveBeenCalled();
  });

  it("throws 404 when skill not found", async () => {
    const selectChain = chainable({
      where: vi.fn().mockResolvedValue([]),
    });
    mockDb.select = vi.fn(() => selectChain);

    const { handler } = registeredRoutes["DELETE /:id"];
    const request = createRequest({ params: { id: "nonexistent" } });

    await expect(handler(request, createReply())).rejects.toThrow("Skill not found");
  });

  it("throws 403 when user is not the skill owner", async () => {
    const otherUserSkill = { ...existingSkill, userId: "user-other" };
    const selectChain = chainable({
      where: vi.fn().mockResolvedValue([otherUserSkill]),
    });
    mockDb.select = vi.fn(() => selectChain);

    const { handler } = registeredRoutes["DELETE /:id"];
    const request = createRequest({
      userId: "user-1",
      params: { id: "skill-1" },
    });

    await expect(handler(request, createReply())).rejects.toThrow("Not authorized to delete this skill");
  });

  it("propagates db errors during select", async () => {
    const selectChain = chainable({
      where: vi.fn().mockRejectedValue(new Error("select failed")),
    });
    mockDb.select = vi.fn(() => selectChain);

    const { handler } = registeredRoutes["DELETE /:id"];
    const request = createRequest({ params: { id: "skill-1" } });

    await expect(handler(request, createReply())).rejects.toThrow("select failed");
  });

  it("propagates db errors during delete", async () => {
    const selectChain = chainable({
      where: vi.fn().mockResolvedValue([existingSkill]),
    });
    mockDb.select = vi.fn(() => selectChain);

    const deleteChain = chainable({
      where: vi.fn().mockRejectedValue(new Error("delete failed")),
    });
    mockDb.delete = vi.fn(() => deleteChain);

    const { handler } = registeredRoutes["DELETE /:id"];
    const request = createRequest({ params: { id: "skill-1" } });

    await expect(handler(request, createReply())).rejects.toThrow("delete failed");
  });
});

// ================================================================
// POST /:id/test — test execute skill with sample inputs
// ================================================================
describe("POST /:id/test", () => {
  const existingSkill = {
    id: "skill-1",
    userId: "user-1",
    name: "Test Skill",
    code: "return 42",
  };

  it("executes skill successfully and returns result", async () => {
    const selectChain = chainable({
      where: vi.fn().mockResolvedValue([existingSkill]),
    });
    mockDb.select = vi.fn(() => selectChain);

    mockExecuteUserSkill.mockResolvedValue({ output: "hello" });

    const { handler } = registeredRoutes["POST /:id/test"];
    const request = createRequest({
      params: { id: "skill-1" },
      body: { inputs: { x: 10 } },
    });

    const result = await handler(request, createReply());
    expect(result).toEqual({ success: true, result: { output: "hello" } });
    expect(mockExecuteUserSkill).toHaveBeenCalledWith("user-1", "Test Skill", { x: 10 });
  });

  it("passes empty object when inputs are not provided", async () => {
    const selectChain = chainable({
      where: vi.fn().mockResolvedValue([existingSkill]),
    });
    mockDb.select = vi.fn(() => selectChain);

    mockExecuteUserSkill.mockResolvedValue("done");

    const { handler } = registeredRoutes["POST /:id/test"];
    const request = createRequest({
      params: { id: "skill-1" },
      body: {},
    });

    const result = await handler(request, createReply());
    expect(result).toEqual({ success: true, result: "done" });
    expect(mockExecuteUserSkill).toHaveBeenCalledWith("user-1", "Test Skill", {});
  });

  it("returns success false with error message when execution fails", async () => {
    const selectChain = chainable({
      where: vi.fn().mockResolvedValue([existingSkill]),
    });
    mockDb.select = vi.fn(() => selectChain);

    mockExecuteUserSkill.mockRejectedValue(new Error("Execution timeout"));

    const { handler } = registeredRoutes["POST /:id/test"];
    const request = createRequest({
      params: { id: "skill-1" },
      body: { inputs: {} },
    });

    const result = await handler(request, createReply());
    expect(result).toEqual({ success: false, error: "Execution timeout" });
  });

  it("returns success false for runtime errors in skill code", async () => {
    const selectChain = chainable({
      where: vi.fn().mockResolvedValue([existingSkill]),
    });
    mockDb.select = vi.fn(() => selectChain);

    mockExecuteUserSkill.mockRejectedValue(new TypeError("Cannot read properties of undefined"));

    const { handler } = registeredRoutes["POST /:id/test"];
    const request = createRequest({
      params: { id: "skill-1" },
      body: {},
    });

    const result = await handler(request, createReply());
    expect(result).toEqual({ success: false, error: "Cannot read properties of undefined" });
  });

  it("throws 404 when skill not found", async () => {
    const selectChain = chainable({
      where: vi.fn().mockResolvedValue([]),
    });
    mockDb.select = vi.fn(() => selectChain);

    const { handler } = registeredRoutes["POST /:id/test"];
    const request = createRequest({
      params: { id: "nonexistent" },
      body: {},
    });

    await expect(handler(request, createReply())).rejects.toThrow("Skill not found");
  });

  it("throws 403 when user is not the skill owner", async () => {
    const otherUserSkill = { ...existingSkill, userId: "user-other" };
    const selectChain = chainable({
      where: vi.fn().mockResolvedValue([otherUserSkill]),
    });
    mockDb.select = vi.fn(() => selectChain);

    const { handler } = registeredRoutes["POST /:id/test"];
    const request = createRequest({
      userId: "user-1",
      params: { id: "skill-1" },
      body: {},
    });

    await expect(handler(request, createReply())).rejects.toThrow("Not authorized to test this skill");
  });

  it("does not call executeUserSkill when skill not found", async () => {
    const selectChain = chainable({
      where: vi.fn().mockResolvedValue([]),
    });
    mockDb.select = vi.fn(() => selectChain);

    const { handler } = registeredRoutes["POST /:id/test"];
    const request = createRequest({
      params: { id: "nonexistent" },
      body: { inputs: { a: 1 } },
    });

    await expect(handler(request, createReply())).rejects.toThrow();
    expect(mockExecuteUserSkill).not.toHaveBeenCalled();
  });

  it("does not call executeUserSkill when user is not owner", async () => {
    const otherUserSkill = { ...existingSkill, userId: "user-other" };
    const selectChain = chainable({
      where: vi.fn().mockResolvedValue([otherUserSkill]),
    });
    mockDb.select = vi.fn(() => selectChain);

    const { handler } = registeredRoutes["POST /:id/test"];
    const request = createRequest({
      userId: "user-1",
      params: { id: "skill-1" },
      body: {},
    });

    await expect(handler(request, createReply())).rejects.toThrow();
    expect(mockExecuteUserSkill).not.toHaveBeenCalled();
  });

  it("propagates db errors during select", async () => {
    const selectChain = chainable({
      where: vi.fn().mockRejectedValue(new Error("db error")),
    });
    mockDb.select = vi.fn(() => selectChain);

    const { handler } = registeredRoutes["POST /:id/test"];
    const request = createRequest({ params: { id: "skill-1" }, body: {} });

    await expect(handler(request, createReply())).rejects.toThrow("db error");
  });
});
