import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";

// ── Mock crypto ──────────────────────────────────────────────────────────────
vi.mock("crypto", () => {
  const actual = {
    randomUUID: vi.fn().mockReturnValue("mock-uuid-1234"),
  };
  return { default: actual, ...actual };
});

// ── Mock drizzle db ──────────────────────────────────────────────────────────
const mockLimit = vi.fn();
const mockWhere = vi.fn().mockReturnValue({ limit: mockLimit });
const mockFrom = vi.fn().mockReturnValue({ where: mockWhere });
const mockSelect = vi.fn().mockReturnValue({ from: mockFrom });
const mockReturning = vi.fn();
const mockValues = vi.fn().mockReturnValue({ returning: mockReturning });
const mockInsert = vi.fn().mockReturnValue({ values: mockValues });
const mockUpdateSet = vi.fn().mockReturnValue({ where: vi.fn().mockReturnValue({ returning: mockReturning }) });
const mockUpdate = vi.fn().mockReturnValue({ set: mockUpdateSet });
const mockDeleteWhere = vi.fn().mockResolvedValue(undefined);
const mockDelete = vi.fn().mockReturnValue({ where: mockDeleteWhere });

vi.mock("../../src/lib/drizzle.js", () => ({
  db: {
    select: (...args: any[]) => mockSelect(...args),
    insert: (...args: any[]) => mockInsert(...args),
    update: (...args: any[]) => mockUpdate(...args),
    delete: (...args: any[]) => mockDelete(...args),
  },
}));

// ── Mock drizzle-orm ─────────────────────────────────────────────────────────
vi.mock("drizzle-orm", () => ({
  eq: vi.fn((a: any, b: any) => ({ field: a, value: b })),
  and: vi.fn((...args: any[]) => ({ and: args })),
  desc: vi.fn((col: any) => ({ desc: col })),
}));

// ── Mock db schema ───────────────────────────────────────────────────────────
vi.mock("../../src/db/schema/council.js", () => ({
  promptDnas: {
    id: "id",
    userId: "userId",
    name: "name",
    systemPrompt: "systemPrompt",
    steeringRules: "steeringRules",
    consensusBias: "consensusBias",
    critiqueStyle: "critiqueStyle",
    createdAt: "createdAt",
  },
}));

// ── Mock fastifyAuth middleware ───────────────────────────────────────────────
vi.mock("../../src/middleware/fastifyAuth.js", () => ({
  fastifyRequireAuth: vi.fn().mockImplementation(async () => {}),
}));

// ── Mock AppError ────────────────────────────────────────────────────────────
vi.mock("../../src/middleware/errorHandler.js", () => ({
  AppError: class AppError extends Error {
    statusCode: number;
    code: string;
    isOperational: boolean;
    constructor(statusCode: number, message: string, code = "INTERNAL_ERROR", isOperational = true) {
      super(message);
      this.statusCode = statusCode;
      this.code = code;
      this.isOperational = isOperational;
    }
  },
}));

import { AppError } from "../../src/middleware/errorHandler.js";
import promptDnaPlugin from "../../src/routes/promptDna.js";

// ── Capture route handlers ───────────────────────────────────────────────────
const routes: Record<string, { handler: Function; opts?: any }> = {};

function captureRoute(method: string) {
  return vi.fn((path: string, optsOrHandler: any, maybeHandler?: any) => {
    const handler = maybeHandler || optsOrHandler;
    const opts = maybeHandler ? optsOrHandler : undefined;
    routes[`${method} ${path}`] = { handler, opts };
  });
}

const mockFastify = {
  get: captureRoute("GET"),
  post: captureRoute("POST"),
  put: captureRoute("PUT"),
  patch: captureRoute("PATCH"),
  delete: captureRoute("DELETE"),
};

// ── Helpers ──────────────────────────────────────────────────────────────────
function createMockReply() {
  const reply: any = {
    statusCode: 200,
    code: vi.fn(function (this: any, c: number) {
      this.statusCode = c;
      return this;
    }),
    send: vi.fn(function (this: any, data: any) {
      return data;
    }),
  };
  return reply;
}

function createMockRequest(overrides: any = {}) {
  return {
    body: {},
    params: {},
    headers: {},
    userId: "user-123",
    ...overrides,
  };
}

// ── Register the plugin once ─────────────────────────────────────────────────
beforeAll(async () => {
  await promptDnaPlugin(mockFastify as any, {});
});

// ── Reset mocks between tests ────────────────────────────────────────────────
beforeEach(() => {
  vi.clearAllMocks();

  // Re-wire the db mock chain defaults
  mockLimit.mockResolvedValue([]);
  mockWhere.mockReturnValue({ limit: mockLimit });
  mockFrom.mockReturnValue({ where: mockWhere, orderBy: vi.fn().mockResolvedValue([]) });
  mockSelect.mockReturnValue({ from: mockFrom });
  mockReturning.mockResolvedValue([]);
  mockValues.mockReturnValue({ returning: mockReturning });
  mockInsert.mockReturnValue({ values: mockValues });
  mockUpdateSet.mockReturnValue({ where: vi.fn().mockReturnValue({ returning: mockReturning }) });
  mockUpdate.mockReturnValue({ set: mockUpdateSet });
  mockDeleteWhere.mockResolvedValue(undefined);
  mockDelete.mockReturnValue({ where: mockDeleteWhere });
});

// ── Route registration ───────────────────────────────────────────────────────
describe("promptDna plugin registration", () => {
  it("registers GET /", () => {
    expect(routes["GET /"]).toBeDefined();
    expect(routes["GET /"].opts?.preHandler).toBeDefined();
  });

  it("registers POST /", () => {
    expect(routes["POST /"]).toBeDefined();
    expect(routes["POST /"].opts?.preHandler).toBeDefined();
  });

  it("registers PUT /:id", () => {
    expect(routes["PUT /:id"]).toBeDefined();
    expect(routes["PUT /:id"].opts?.preHandler).toBeDefined();
  });

  it("registers DELETE /:id", () => {
    expect(routes["DELETE /:id"]).toBeDefined();
    expect(routes["DELETE /:id"].opts?.preHandler).toBeDefined();
  });
});

// ── GET / ────────────────────────────────────────────────────────────────────
describe("GET / — list PromptDNA profiles", () => {
  it("returns an empty list when user has no profiles", async () => {
    const mockOrderBy = vi.fn().mockResolvedValue([]);
    mockFrom.mockReturnValue({ where: vi.fn().mockReturnValue({ orderBy: mockOrderBy }) });

    const request = createMockRequest();
    const reply = createMockReply();

    const result = await routes["GET /"].handler(request, reply);
    expect(result).toEqual({ dnas: [] });
  });

  it("returns user's PromptDNA profiles ordered by createdAt desc", async () => {
    const dnas = [
      { id: "dna-1", name: "Profile A", userId: "user-123", createdAt: "2025-01-02" },
      { id: "dna-2", name: "Profile B", userId: "user-123", createdAt: "2025-01-01" },
    ];
    const mockOrderBy = vi.fn().mockResolvedValue(dnas);
    mockFrom.mockReturnValue({ where: vi.fn().mockReturnValue({ orderBy: mockOrderBy }) });

    const request = createMockRequest();
    const reply = createMockReply();

    const result = await routes["GET /"].handler(request, reply);
    expect(result).toEqual({ dnas });
    expect(mockSelect).toHaveBeenCalled();
  });
});

// ── POST / ───────────────────────────────────────────────────────────────────
describe("POST / — create PromptDNA", () => {
  it("creates a profile with required fields and defaults", async () => {
    const createdDna = {
      id: "mock-uuid-1234",
      userId: "user-123",
      name: "My Persona",
      systemPrompt: "You are helpful",
      steeringRules: "",
      consensusBias: "neutral",
      critiqueStyle: "evidence_based",
    };
    mockReturning.mockResolvedValue([createdDna]);

    const request = createMockRequest({
      body: { name: "My Persona", systemPrompt: "You are helpful" },
    });
    const reply = createMockReply();

    const result = await routes["POST /"].handler(request, reply);
    expect(result).toEqual(createdDna);
    expect(reply.code).toHaveBeenCalledWith(201);
    expect(mockInsert).toHaveBeenCalled();
  });

  it("creates a profile with all optional fields provided", async () => {
    const createdDna = {
      id: "mock-uuid-1234",
      userId: "user-123",
      name: "Custom",
      systemPrompt: "Be creative",
      steeringRules: "rule1",
      consensusBias: "agree",
      critiqueStyle: "socratic",
    };
    mockReturning.mockResolvedValue([createdDna]);

    const request = createMockRequest({
      body: {
        name: "Custom",
        systemPrompt: "Be creative",
        steeringRules: "rule1",
        consensusBias: "agree",
        critiqueStyle: "socratic",
      },
    });
    const reply = createMockReply();

    const result = await routes["POST /"].handler(request, reply);
    expect(result).toEqual(createdDna);
    expect(reply.code).toHaveBeenCalledWith(201);
  });

  it("trims name and systemPrompt", async () => {
    mockReturning.mockResolvedValue([{ id: "mock-uuid-1234" }]);

    const request = createMockRequest({
      body: { name: "  trimmed  ", systemPrompt: "  prompt  " },
    });
    const reply = createMockReply();

    await routes["POST /"].handler(request, reply);

    const valuesCall = mockValues.mock.calls[0][0];
    expect(valuesCall.name).toBe("trimmed");
    expect(valuesCall.systemPrompt).toBe("prompt");
  });

  it("throws AppError 400 when name is missing", async () => {
    const request = createMockRequest({
      body: { systemPrompt: "You are helpful" },
    });
    const reply = createMockReply();

    await expect(routes["POST /"].handler(request, reply)).rejects.toThrow();
    try {
      await routes["POST /"].handler(request, reply);
    } catch (err: any) {
      expect(err).toBeInstanceOf(AppError);
      expect(err.statusCode).toBe(400);
      expect(err.code).toBe("DNA_NAME_REQUIRED");
    }
  });

  it("throws AppError 400 when name is not a string", async () => {
    const request = createMockRequest({
      body: { name: 123, systemPrompt: "You are helpful" },
    });
    const reply = createMockReply();

    await expect(routes["POST /"].handler(request, reply)).rejects.toThrow();
  });

  it("throws AppError 400 when name is empty string", async () => {
    const request = createMockRequest({
      body: { name: "", systemPrompt: "You are helpful" },
    });
    const reply = createMockReply();

    await expect(routes["POST /"].handler(request, reply)).rejects.toThrow();
    try {
      await routes["POST /"].handler(request, reply);
    } catch (err: any) {
      expect(err.statusCode).toBe(400);
      expect(err.code).toBe("DNA_NAME_REQUIRED");
    }
  });

  it("throws AppError 400 when systemPrompt is missing", async () => {
    const request = createMockRequest({
      body: { name: "My Persona" },
    });
    const reply = createMockReply();

    await expect(routes["POST /"].handler(request, reply)).rejects.toThrow();
    try {
      await routes["POST /"].handler(request, reply);
    } catch (err: any) {
      expect(err).toBeInstanceOf(AppError);
      expect(err.statusCode).toBe(400);
      expect(err.code).toBe("DNA_PROMPT_REQUIRED");
    }
  });

  it("throws AppError 400 when systemPrompt is not a string", async () => {
    const request = createMockRequest({
      body: { name: "My Persona", systemPrompt: 42 },
    });
    const reply = createMockReply();

    await expect(routes["POST /"].handler(request, reply)).rejects.toThrow();
  });

  it("throws AppError 400 when systemPrompt is empty string", async () => {
    const request = createMockRequest({
      body: { name: "My Persona", systemPrompt: "" },
    });
    const reply = createMockReply();

    await expect(routes["POST /"].handler(request, reply)).rejects.toThrow();
    try {
      await routes["POST /"].handler(request, reply);
    } catch (err: any) {
      expect(err.statusCode).toBe(400);
      expect(err.code).toBe("DNA_PROMPT_REQUIRED");
    }
  });

  it("defaults consensusBias to 'neutral' when not provided", async () => {
    mockReturning.mockResolvedValue([{ id: "mock-uuid-1234" }]);

    const request = createMockRequest({
      body: { name: "Test", systemPrompt: "prompt" },
    });
    const reply = createMockReply();

    await routes["POST /"].handler(request, reply);

    const valuesCall = mockValues.mock.calls[0][0];
    expect(valuesCall.consensusBias).toBe("neutral");
  });

  it("defaults critiqueStyle to 'evidence_based' when not provided", async () => {
    mockReturning.mockResolvedValue([{ id: "mock-uuid-1234" }]);

    const request = createMockRequest({
      body: { name: "Test", systemPrompt: "prompt" },
    });
    const reply = createMockReply();

    await routes["POST /"].handler(request, reply);

    const valuesCall = mockValues.mock.calls[0][0];
    expect(valuesCall.critiqueStyle).toBe("evidence_based");
  });

  it("defaults steeringRules to empty string when not provided", async () => {
    mockReturning.mockResolvedValue([{ id: "mock-uuid-1234" }]);

    const request = createMockRequest({
      body: { name: "Test", systemPrompt: "prompt" },
    });
    const reply = createMockReply();

    await routes["POST /"].handler(request, reply);

    const valuesCall = mockValues.mock.calls[0][0];
    expect(valuesCall.steeringRules).toBe("");
  });
});

// ── PUT /:id ─────────────────────────────────────────────────────────────────
describe("PUT /:id — update PromptDNA", () => {
  const existingDna = {
    id: "dna-1",
    userId: "user-123",
    name: "Old Name",
    systemPrompt: "Old prompt",
    steeringRules: "",
    consensusBias: "neutral",
    critiqueStyle: "evidence_based",
  };

  it("updates a profile when it exists and belongs to user", async () => {
    mockLimit.mockResolvedValue([existingDna]);

    const updatedDna = { ...existingDna, name: "New Name" };
    const mockUpdateReturning = vi.fn().mockResolvedValue([updatedDna]);
    const mockUpdateWhere = vi.fn().mockReturnValue({ returning: mockUpdateReturning });
    mockUpdateSet.mockReturnValue({ where: mockUpdateWhere });

    const request = createMockRequest({
      params: { id: "dna-1" },
      body: { name: "New Name" },
    });
    const reply = createMockReply();

    const result = await routes["PUT /:id"].handler(request, reply);
    expect(result).toEqual(updatedDna);
  });

  it("updates only the fields that are provided", async () => {
    mockLimit.mockResolvedValue([existingDna]);

    const updatedDna = { ...existingDna, systemPrompt: "Updated prompt" };
    const mockUpdateReturning = vi.fn().mockResolvedValue([updatedDna]);
    const mockUpdateWhere = vi.fn().mockReturnValue({ returning: mockUpdateReturning });
    mockUpdateSet.mockReturnValue({ where: mockUpdateWhere });

    const request = createMockRequest({
      params: { id: "dna-1" },
      body: { systemPrompt: "Updated prompt" },
    });
    const reply = createMockReply();

    await routes["PUT /:id"].handler(request, reply);

    const setCall = mockUpdateSet.mock.calls[0][0];
    expect(setCall.systemPrompt).toBe("Updated prompt");
    expect(setCall.name).toBeUndefined();
    expect(setCall.consensusBias).toBeUndefined();
  });

  it("trims string fields when updating", async () => {
    mockLimit.mockResolvedValue([existingDna]);

    const mockUpdateReturning = vi.fn().mockResolvedValue([existingDna]);
    const mockUpdateWhere = vi.fn().mockReturnValue({ returning: mockUpdateReturning });
    mockUpdateSet.mockReturnValue({ where: mockUpdateWhere });

    const request = createMockRequest({
      params: { id: "dna-1" },
      body: { name: "  trimmed  ", systemPrompt: "  prompt  ", steeringRules: "  rules  " },
    });
    const reply = createMockReply();

    await routes["PUT /:id"].handler(request, reply);

    const setCall = mockUpdateSet.mock.calls[0][0];
    expect(setCall.name).toBe("trimmed");
    expect(setCall.systemPrompt).toBe("prompt");
    expect(setCall.steeringRules).toBe("rules");
  });

  it("updates all fields when all are provided", async () => {
    mockLimit.mockResolvedValue([existingDna]);

    const mockUpdateReturning = vi.fn().mockResolvedValue([existingDna]);
    const mockUpdateWhere = vi.fn().mockReturnValue({ returning: mockUpdateReturning });
    mockUpdateSet.mockReturnValue({ where: mockUpdateWhere });

    const request = createMockRequest({
      params: { id: "dna-1" },
      body: {
        name: "New",
        systemPrompt: "New prompt",
        steeringRules: "New rules",
        consensusBias: "agree",
        critiqueStyle: "socratic",
      },
    });
    const reply = createMockReply();

    await routes["PUT /:id"].handler(request, reply);

    const setCall = mockUpdateSet.mock.calls[0][0];
    expect(setCall.name).toBe("New");
    expect(setCall.systemPrompt).toBe("New prompt");
    expect(setCall.steeringRules).toBe("New rules");
    expect(setCall.consensusBias).toBe("agree");
    expect(setCall.critiqueStyle).toBe("socratic");
  });

  it("throws AppError 404 when profile does not exist", async () => {
    mockLimit.mockResolvedValue([]);

    const request = createMockRequest({
      params: { id: "nonexistent" },
      body: { name: "New Name" },
    });
    const reply = createMockReply();

    await expect(routes["PUT /:id"].handler(request, reply)).rejects.toThrow();
    try {
      await routes["PUT /:id"].handler(request, reply);
    } catch (err: any) {
      expect(err).toBeInstanceOf(AppError);
      expect(err.statusCode).toBe(404);
      expect(err.code).toBe("DNA_NOT_FOUND");
    }
  });

  it("throws AppError 404 when profile belongs to different user", async () => {
    // The where clause filters by userId, so no match means not found
    mockLimit.mockResolvedValue([]);

    const request = createMockRequest({
      params: { id: "dna-1" },
      body: { name: "Hijack" },
      userId: "other-user",
    });
    const reply = createMockReply();

    await expect(routes["PUT /:id"].handler(request, reply)).rejects.toThrow();
    try {
      await routes["PUT /:id"].handler(request, reply);
    } catch (err: any) {
      expect(err.statusCode).toBe(404);
      expect(err.code).toBe("DNA_NOT_FOUND");
    }
  });
});

// ── DELETE /:id ──────────────────────────────────────────────────────────────
describe("DELETE /:id — delete PromptDNA", () => {
  const existingDna = {
    id: "dna-1",
    userId: "user-123",
    name: "To Delete",
    systemPrompt: "prompt",
  };

  it("deletes a profile when it exists and belongs to user", async () => {
    mockLimit.mockResolvedValue([existingDna]);

    const request = createMockRequest({
      params: { id: "dna-1" },
    });
    const reply = createMockReply();

    const result = await routes["DELETE /:id"].handler(request, reply);
    expect(result).toEqual({ success: true });
    expect(mockDelete).toHaveBeenCalled();
  });

  it("throws AppError 404 when profile does not exist", async () => {
    mockLimit.mockResolvedValue([]);

    const request = createMockRequest({
      params: { id: "nonexistent" },
    });
    const reply = createMockReply();

    await expect(routes["DELETE /:id"].handler(request, reply)).rejects.toThrow();
    try {
      await routes["DELETE /:id"].handler(request, reply);
    } catch (err: any) {
      expect(err).toBeInstanceOf(AppError);
      expect(err.statusCode).toBe(404);
      expect(err.code).toBe("DNA_NOT_FOUND");
    }
  });

  it("throws AppError 404 when profile belongs to different user", async () => {
    mockLimit.mockResolvedValue([]);

    const request = createMockRequest({
      params: { id: "dna-1" },
      userId: "other-user",
    });
    const reply = createMockReply();

    await expect(routes["DELETE /:id"].handler(request, reply)).rejects.toThrow();
    try {
      await routes["DELETE /:id"].handler(request, reply);
    } catch (err: any) {
      expect(err.statusCode).toBe(404);
      expect(err.code).toBe("DNA_NOT_FOUND");
    }
  });
});
