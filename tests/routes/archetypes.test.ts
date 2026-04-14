import { describe, it, expect, vi, beforeEach } from "vitest";

// ---- mocks ----

const mockGetUserArchetypes = vi.fn();
const mockUpsertUserArchetype = vi.fn();
const mockDeleteUserArchetype = vi.fn();
const mockToggleArchetypeStatus = vi.fn();
const mockValidateArchetype = vi.fn();
const mockCloneDefaultArchetype = vi.fn();
const mockExportUserArchetypes = vi.fn();
const mockImportArchetypes = vi.fn();
const mockGetArchetypeUsage = vi.fn();

vi.mock("../../src/lib/archetypes.js", () => ({
  getUserArchetypes: (...args: any[]) => mockGetUserArchetypes(...args),
  upsertUserArchetype: (...args: any[]) => mockUpsertUserArchetype(...args),
  deleteUserArchetype: (...args: any[]) => mockDeleteUserArchetype(...args),
  toggleArchetypeStatus: (...args: any[]) => mockToggleArchetypeStatus(...args),
  validateArchetype: (...args: any[]) => mockValidateArchetype(...args),
  cloneDefaultArchetype: (...args: any[]) => mockCloneDefaultArchetype(...args),
  exportUserArchetypes: (...args: any[]) => mockExportUserArchetypes(...args),
  importArchetypes: (...args: any[]) => mockImportArchetypes(...args),
  getArchetypeUsage: (...args: any[]) => mockGetArchetypeUsage(...args),
}));

vi.mock("../../src/middleware/fastifyAuth.js", () => ({
  fastifyOptionalAuth: vi.fn(),
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

const MOCK_ARCHETYPES = {
  analyst: {
    id: "analyst",
    name: "Analyst",
    thinkingStyle: "analytical",
    asks: "What does the data say?",
    blindSpot: "May overlook emotions",
    systemPrompt: "You are an analytical thinker who examines data carefully.",
  },
  creative: {
    id: "creative",
    name: "Creative",
    thinkingStyle: "creative",
    asks: "What if we tried something new?",
    blindSpot: "May ignore constraints",
    systemPrompt: "You are a creative thinker who explores novel ideas.",
  },
};

vi.mock("../../src/config/archetypes.js", () => ({
  ARCHETYPES: MOCK_ARCHETYPES,
}));

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
    patch: register("PATCH"),
    delete: register("DELETE"),
  };
}

function createRequest(
  overrides: Partial<{ userId: number | undefined; body: any; params: any; headers: Record<string, string> }> = {}
): any {
  return {
    userId: "userId" in overrides ? overrides.userId : 1,
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
    send: vi.fn(function (this: any, data: any) {
      this._sent = data;
      return this;
    }),
    header: vi.fn(function (this: any) {
      return this;
    }),
  };
  return reply;
}

// ---- import and register the plugin ----

let archetypesPlugin: any;

beforeEach(async () => {
  vi.clearAllMocks();
  for (const key of Object.keys(registeredRoutes)) {
    delete registeredRoutes[key];
  }

  const mod = await import("../../src/routes/archetypes.js");
  archetypesPlugin = mod.default;
  const fastify = createFastifyInstance();
  await archetypesPlugin(fastify);
});

// ================================================================
// Route registration
// ================================================================
describe("route registration", () => {
  it("registers all expected routes", () => {
    expect(registeredRoutes["GET /"]).toBeDefined();
    expect(registeredRoutes["POST /"]).toBeDefined();
    expect(registeredRoutes["DELETE /:id"]).toBeDefined();
    expect(registeredRoutes["PATCH /:id/toggle"]).toBeDefined();
    expect(registeredRoutes["POST /:id/clone"]).toBeDefined();
    expect(registeredRoutes["GET /export"]).toBeDefined();
    expect(registeredRoutes["POST /import"]).toBeDefined();
    expect(registeredRoutes["GET /usage"]).toBeDefined();
  });

  it("all routes have a preHandler for auth", () => {
    for (const key of Object.keys(registeredRoutes)) {
      expect(registeredRoutes[key].preHandler).toBeDefined();
    }
  });
});

// ================================================================
// GET / - list archetypes
// ================================================================
describe("GET /", () => {
  it("returns default archetypes when user is not authenticated", async () => {
    const { handler } = registeredRoutes["GET /"];
    const request = createRequest({ userId: undefined });
    const result = await handler(request, createReply());

    expect(result.isCustom).toBe(false);
    expect(result.archetypes).toBeDefined();
    expect(mockGetUserArchetypes).not.toHaveBeenCalled();
    expect(mockGetArchetypeUsage).not.toHaveBeenCalled();
  });

  it("returns custom archetypes with usage for authenticated user", async () => {
    const customArchetypes = { custom1: { id: "custom1", name: "Custom" } };
    const usage = { custom1: 5, analyst: 10 };
    mockGetUserArchetypes.mockResolvedValue(customArchetypes);
    mockGetArchetypeUsage.mockResolvedValue(usage);

    const { handler } = registeredRoutes["GET /"];
    const result = await handler(createRequest({ userId: 42 }), createReply());

    expect(result).toEqual({ archetypes: customArchetypes, usage, isCustom: true });
    expect(mockGetUserArchetypes).toHaveBeenCalledWith(42);
    expect(mockGetArchetypeUsage).toHaveBeenCalledWith(42);
  });

  it("propagates errors from getUserArchetypes", async () => {
    mockGetUserArchetypes.mockRejectedValue(new Error("db down"));

    const { handler } = registeredRoutes["GET /"];
    await expect(handler(createRequest(), createReply())).rejects.toThrow("db down");
  });

  it("propagates errors from getArchetypeUsage", async () => {
    mockGetUserArchetypes.mockResolvedValue({});
    mockGetArchetypeUsage.mockRejectedValue(new Error("usage error"));

    const { handler } = registeredRoutes["GET /"];
    await expect(handler(createRequest(), createReply())).rejects.toThrow("usage error");
  });
});

// ================================================================
// POST / - create/update archetype
// ================================================================
describe("POST /", () => {
  const validBody = {
    name: "Test",
    thinkingStyle: "analytical thinking",
    asks: "What is happening?",
    blindSpot: "Misses the forest",
    systemPrompt: "You are a test archetype with careful reasoning.",
  };

  it("throws 401 when user is not authenticated", async () => {
    const { handler } = registeredRoutes["POST /"];
    const request = createRequest({ userId: undefined });

    try {
      await handler(request, createReply());
      expect.fail("should have thrown");
    } catch (err: any) {
      expect(err.statusCode).toBe(401);
      expect(err.message).toBe("Authentication required for custom archetypes");
    }
  });

  it("creates an archetype successfully when no archetypeId is provided", async () => {
    const created = { id: "custom_123", name: "Test" };
    mockValidateArchetype.mockReturnValue({ valid: true, errors: [] });
    mockUpsertUserArchetype.mockResolvedValue(created);

    const { handler } = registeredRoutes["POST /"];
    const request = createRequest({ body: { ...validBody } });
    const result = await handler(request, createReply());

    expect(result).toEqual({
      message: "Archetype created successfully",
      archetype: created,
    });
    expect(mockUpsertUserArchetype).toHaveBeenCalledWith(1, expect.objectContaining({ name: "Test" }), undefined);
  });

  it("updates an archetype when archetypeId is provided", async () => {
    const updated = { id: "existing_1", name: "Updated" };
    mockValidateArchetype.mockReturnValue({ valid: true, errors: [] });
    mockUpsertUserArchetype.mockResolvedValue(updated);

    const { handler } = registeredRoutes["POST /"];
    const request = createRequest({ body: { archetypeId: "existing_1", ...validBody } });
    const result = await handler(request, createReply());

    expect(result).toEqual({
      message: "Archetype updated successfully",
      archetype: updated,
    });
    expect(mockUpsertUserArchetype).toHaveBeenCalledWith(1, expect.objectContaining({ name: "Test" }), "existing_1");
  });

  it("does not pass archetypeId as part of archetype data", async () => {
    mockValidateArchetype.mockReturnValue({ valid: true, errors: [] });
    mockUpsertUserArchetype.mockResolvedValue({});

    const { handler } = registeredRoutes["POST /"];
    const request = createRequest({ body: { archetypeId: "some_id", ...validBody } });
    await handler(request, createReply());

    const dataArg = mockUpsertUserArchetype.mock.calls[0][1];
    expect(dataArg.archetypeId).toBeUndefined();
  });

  it("throws 400 when validation fails", async () => {
    mockValidateArchetype.mockReturnValue({ valid: false, errors: ["Name too short", "Missing prompt"] });

    const { handler } = registeredRoutes["POST /"];
    const request = createRequest({ body: { name: "X" } });

    try {
      await handler(request, createReply());
      expect.fail("should have thrown");
    } catch (err: any) {
      expect(err.statusCode).toBe(400);
      expect(err.message).toBe("Validation failed: Name too short, Missing prompt");
    }
  });

  it("calls validateArchetype with archetype data (excluding archetypeId)", async () => {
    mockValidateArchetype.mockReturnValue({ valid: true, errors: [] });
    mockUpsertUserArchetype.mockResolvedValue({});

    const { handler } = registeredRoutes["POST /"];
    const request = createRequest({ body: { archetypeId: "id1", ...validBody } });
    await handler(request, createReply());

    const validateArg = mockValidateArchetype.mock.calls[0][0];
    expect(validateArg.archetypeId).toBeUndefined();
    expect(validateArg.name).toBe("Test");
  });

  it("propagates errors from upsertUserArchetype", async () => {
    mockValidateArchetype.mockReturnValue({ valid: true, errors: [] });
    mockUpsertUserArchetype.mockRejectedValue(new Error("upsert failed"));

    const { handler } = registeredRoutes["POST /"];
    const request = createRequest({ body: validBody });

    await expect(handler(request, createReply())).rejects.toThrow("upsert failed");
  });
});

// ================================================================
// DELETE /:id - delete archetype
// ================================================================
describe("DELETE /:id", () => {
  it("throws 401 when user is not authenticated", async () => {
    const { handler } = registeredRoutes["DELETE /:id"];
    const request = createRequest({ userId: undefined, params: { id: "a1" } });

    try {
      await handler(request, createReply());
      expect.fail("should have thrown");
    } catch (err: any) {
      expect(err.statusCode).toBe(401);
      expect(err.message).toBe("Authentication required");
    }
  });

  it("deletes archetype successfully", async () => {
    mockDeleteUserArchetype.mockResolvedValue(undefined);

    const { handler } = registeredRoutes["DELETE /:id"];
    const request = createRequest({ userId: 5, params: { id: "arch_1" } });
    const result = await handler(request, createReply());

    expect(result).toEqual({ message: "Archetype deleted successfully" });
    expect(mockDeleteUserArchetype).toHaveBeenCalledWith(5, "arch_1");
  });

  it("propagates errors from deleteUserArchetype", async () => {
    mockDeleteUserArchetype.mockRejectedValue(new Error("delete failed"));

    const { handler } = registeredRoutes["DELETE /:id"];
    const request = createRequest({ params: { id: "a1" } });

    await expect(handler(request, createReply())).rejects.toThrow("delete failed");
  });
});

// ================================================================
// PATCH /:id/toggle - toggle archetype status
// ================================================================
describe("PATCH /:id/toggle", () => {
  it("throws 401 when user is not authenticated", async () => {
    const { handler } = registeredRoutes["PATCH /:id/toggle"];
    const request = createRequest({ userId: undefined, params: { id: "a1" } });

    try {
      await handler(request, createReply());
      expect.fail("should have thrown");
    } catch (err: any) {
      expect(err.statusCode).toBe(401);
    }
  });

  it("returns activated message when toggled to active", async () => {
    mockToggleArchetypeStatus.mockResolvedValue(true);

    const { handler } = registeredRoutes["PATCH /:id/toggle"];
    const request = createRequest({ userId: 3, params: { id: "arch_1" } });
    const result = await handler(request, createReply());

    expect(result).toEqual({
      message: "Archetype activated successfully",
      isActive: true,
    });
    expect(mockToggleArchetypeStatus).toHaveBeenCalledWith(3, "arch_1");
  });

  it("returns deactivated message when toggled to inactive", async () => {
    mockToggleArchetypeStatus.mockResolvedValue(false);

    const { handler } = registeredRoutes["PATCH /:id/toggle"];
    const request = createRequest({ params: { id: "arch_2" } });
    const result = await handler(request, createReply());

    expect(result).toEqual({
      message: "Archetype deactivated successfully",
      isActive: false,
    });
  });

  it("propagates errors from toggleArchetypeStatus", async () => {
    mockToggleArchetypeStatus.mockRejectedValue(new Error("toggle failed"));

    const { handler } = registeredRoutes["PATCH /:id/toggle"];
    const request = createRequest({ params: { id: "a1" } });

    await expect(handler(request, createReply())).rejects.toThrow("toggle failed");
  });
});

// ================================================================
// POST /:id/clone - clone default archetype
// ================================================================
describe("POST /:id/clone", () => {
  const clonedData = {
    name: "Custom Analyst",
    thinkingStyle: "analytical",
    asks: "What does the data say?",
    blindSpot: "May overlook emotions",
    systemPrompt: "You are an analytical thinker who examines data carefully.",
    tools: [],
    icon: undefined,
    colorBg: undefined,
  };

  it("throws 401 when user is not authenticated", async () => {
    const { handler } = registeredRoutes["POST /:id/clone"];
    const request = createRequest({ userId: undefined, params: { id: "analyst" } });

    try {
      await handler(request, createReply());
      expect.fail("should have thrown");
    } catch (err: any) {
      expect(err.statusCode).toBe(401);
    }
  });

  it("clones a default archetype successfully", async () => {
    const created = { id: "custom_analyst", name: "Custom Analyst" };
    mockCloneDefaultArchetype.mockReturnValue({ ...clonedData });
    mockValidateArchetype.mockReturnValue({ valid: true, errors: [] });
    mockUpsertUserArchetype.mockResolvedValue(created);

    const { handler } = registeredRoutes["POST /:id/clone"];
    const request = createRequest({ userId: 7, params: { id: "analyst" } });
    const result = await handler(request, createReply());

    expect(result).toEqual({
      message: "Archetype cloned successfully",
      archetype: created,
    });
    expect(mockCloneDefaultArchetype).toHaveBeenCalledWith("analyst");
    expect(mockUpsertUserArchetype).toHaveBeenCalledWith(7, expect.objectContaining({ name: "Custom Analyst" }));
  });

  it("merges body customizations over cloned data", async () => {
    mockCloneDefaultArchetype.mockReturnValue({ ...clonedData });
    mockValidateArchetype.mockReturnValue({ valid: true, errors: [] });
    mockUpsertUserArchetype.mockResolvedValue({});

    const { handler } = registeredRoutes["POST /:id/clone"];
    const request = createRequest({
      params: { id: "analyst" },
      body: { name: "My Custom Name", icon: "brain" },
    });
    await handler(request, createReply());

    const finalArg = mockUpsertUserArchetype.mock.calls[0][1];
    expect(finalArg.name).toBe("My Custom Name");
    expect(finalArg.icon).toBe("brain");
    expect(finalArg.thinkingStyle).toBe("analytical");
  });

  it("throws 400 when validation of cloned+customized data fails", async () => {
    mockCloneDefaultArchetype.mockReturnValue({ ...clonedData });
    mockValidateArchetype.mockReturnValue({ valid: false, errors: ["System prompt too short"] });

    const { handler } = registeredRoutes["POST /:id/clone"];
    const request = createRequest({
      params: { id: "analyst" },
      body: { systemPrompt: "short" },
    });

    try {
      await handler(request, createReply());
      expect.fail("should have thrown");
    } catch (err: any) {
      expect(err.statusCode).toBe(400);
      expect(err.message).toContain("System prompt too short");
    }
  });

  it("propagates error when cloneDefaultArchetype throws (invalid id)", async () => {
    mockCloneDefaultArchetype.mockImplementation(() => {
      throw new Error("Default archetype 'nonexistent' not found");
    });

    const { handler } = registeredRoutes["POST /:id/clone"];
    const request = createRequest({ params: { id: "nonexistent" } });

    await expect(handler(request, createReply())).rejects.toThrow("Default archetype 'nonexistent' not found");
  });

  it("does not call upsert when validation fails", async () => {
    mockCloneDefaultArchetype.mockReturnValue({ ...clonedData });
    mockValidateArchetype.mockReturnValue({ valid: false, errors: ["bad"] });

    const { handler } = registeredRoutes["POST /:id/clone"];
    const request = createRequest({ params: { id: "analyst" } });

    try {
      await handler(request, createReply());
    } catch {
      // expected
    }

    expect(mockUpsertUserArchetype).not.toHaveBeenCalled();
  });
});

// ================================================================
// GET /export - export user archetypes
// ================================================================
describe("GET /export", () => {
  it("throws 401 when user is not authenticated", async () => {
    const { handler } = registeredRoutes["GET /export"];
    const request = createRequest({ userId: undefined });

    try {
      await handler(request, createReply());
      expect.fail("should have thrown");
    } catch (err: any) {
      expect(err.statusCode).toBe(401);
    }
  });

  it("exports archetypes with proper headers", async () => {
    const exportJson = '[{"name":"Test"}]';
    mockExportUserArchetypes.mockResolvedValue(exportJson);

    const { handler } = registeredRoutes["GET /export"];
    const reply = createReply();
    const request = createRequest({ userId: 10 });
    await handler(request, reply);

    expect(mockExportUserArchetypes).toHaveBeenCalledWith(10);
    expect(reply.header).toHaveBeenCalledWith("Content-Type", "application/json");
    expect(reply.header).toHaveBeenCalledWith(
      "Content-Disposition",
      'attachment; filename="archetypes.json"'
    );
    expect(reply.send).toHaveBeenCalledWith(exportJson);
  });

  it("propagates errors from exportUserArchetypes", async () => {
    mockExportUserArchetypes.mockRejectedValue(new Error("export failed"));

    const { handler } = registeredRoutes["GET /export"];
    await expect(handler(createRequest(), createReply())).rejects.toThrow("export failed");
  });
});

// ================================================================
// POST /import - import archetypes
// ================================================================
describe("POST /import", () => {
  it("throws 401 when user is not authenticated", async () => {
    const { handler } = registeredRoutes["POST /import"];
    const request = createRequest({ userId: undefined, body: { jsonData: "[]" } });

    try {
      await handler(request, createReply());
      expect.fail("should have thrown");
    } catch (err: any) {
      expect(err.statusCode).toBe(401);
    }
  });

  it("throws 400 when jsonData is missing", async () => {
    const { handler } = registeredRoutes["POST /import"];
    const request = createRequest({ body: {} });

    try {
      await handler(request, createReply());
      expect.fail("should have thrown");
    } catch (err: any) {
      expect(err.statusCode).toBe(400);
      expect(err.message).toBe("JSON data is required");
    }
  });

  it("throws 400 when jsonData is null", async () => {
    const { handler } = registeredRoutes["POST /import"];
    const request = createRequest({ body: { jsonData: null } });

    try {
      await handler(request, createReply());
      expect.fail("should have thrown");
    } catch (err: any) {
      expect(err.statusCode).toBe(400);
    }
  });

  it("returns success response when all archetypes import without errors", async () => {
    mockImportArchetypes.mockResolvedValue({ imported: 3, errors: [] });

    const { handler } = registeredRoutes["POST /import"];
    const request = createRequest({ userId: 8, body: { jsonData: "[...]" } });
    const reply = createReply();
    const result = await handler(request, reply);

    expect(result).toEqual({
      message: "Successfully imported 3 archetypes",
      imported: 3,
    });
    expect(mockImportArchetypes).toHaveBeenCalledWith(8, "[...]");
    // Should not set 207 status
    expect(reply.code).not.toHaveBeenCalled();
  });

  it("returns 207 with partial success when some imports fail", async () => {
    mockImportArchetypes.mockResolvedValue({
      imported: 2,
      errors: ["Archetype 'bad' validation failed"],
    });

    const { handler } = registeredRoutes["POST /import"];
    const reply = createReply();
    const request = createRequest({ body: { jsonData: "[...]" } });
    const result = await handler(request, reply);

    expect(reply.code).toHaveBeenCalledWith(207);
    expect(result).toEqual({
      message: "Imported 2 archetypes with 1 errors",
      imported: 2,
      errors: ["Archetype 'bad' validation failed"],
    });
  });

  it("returns 207 with multiple errors", async () => {
    mockImportArchetypes.mockResolvedValue({
      imported: 0,
      errors: ["Error 1", "Error 2", "Error 3"],
    });

    const { handler } = registeredRoutes["POST /import"];
    const reply = createReply();
    const request = createRequest({ body: { jsonData: "[...]" } });
    const result = await handler(request, reply);

    expect(reply.code).toHaveBeenCalledWith(207);
    expect(result.errors).toHaveLength(3);
    expect(result.imported).toBe(0);
  });

  it("propagates errors from importArchetypes", async () => {
    mockImportArchetypes.mockRejectedValue(new Error("import exploded"));

    const { handler } = registeredRoutes["POST /import"];
    const request = createRequest({ body: { jsonData: "[...]" } });

    await expect(handler(request, createReply())).rejects.toThrow("import exploded");
  });
});

// ================================================================
// GET /usage - get archetype usage
// ================================================================
describe("GET /usage", () => {
  it("throws 401 when user is not authenticated", async () => {
    const { handler } = registeredRoutes["GET /usage"];
    const request = createRequest({ userId: undefined });

    try {
      await handler(request, createReply());
      expect.fail("should have thrown");
    } catch (err: any) {
      expect(err.statusCode).toBe(401);
    }
  });

  it("returns usage data for authenticated user", async () => {
    const usage = { analyst: 15, creative: 8 };
    mockGetArchetypeUsage.mockResolvedValue(usage);

    const { handler } = registeredRoutes["GET /usage"];
    const request = createRequest({ userId: 20 });
    const result = await handler(request, createReply());

    expect(result).toEqual({ usage });
    expect(mockGetArchetypeUsage).toHaveBeenCalledWith(20);
  });

  it("returns empty usage when no archetypes have been used", async () => {
    mockGetArchetypeUsage.mockResolvedValue({});

    const { handler } = registeredRoutes["GET /usage"];
    const result = await handler(createRequest(), createReply());

    expect(result).toEqual({ usage: {} });
  });

  it("propagates errors from getArchetypeUsage", async () => {
    mockGetArchetypeUsage.mockRejectedValue(new Error("usage query failed"));

    const { handler } = registeredRoutes["GET /usage"];
    await expect(handler(createRequest(), createReply())).rejects.toThrow("usage query failed");
  });
});
