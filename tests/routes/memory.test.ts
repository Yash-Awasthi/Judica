import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";

// ── Mock drizzle db ──────────────────────────────────────────────────────────
const mockReturning = vi.fn();
const mockDeleteWhere = vi.fn().mockReturnValue({ returning: mockReturning });
const mockDelete = vi.fn().mockReturnValue({ where: mockDeleteWhere });
const mockSelectLimit = vi.fn();
const mockSelectWhere = vi.fn();
// By default, mockSelectWhere returns an object with .limit and .then (thenable).
// Tests that end at .where() set mockSelectWhere.mockResolvedValue(...)
// Tests that chain .limit() set mockSelectLimit accordingly.
mockSelectWhere.mockReturnValue({ limit: mockSelectLimit });
const mockSelectFrom = vi.fn().mockReturnValue({ where: mockSelectWhere });
const mockSelect = vi.fn().mockReturnValue({ from: mockSelectFrom });

vi.mock("../../src/lib/drizzle.js", () => ({
  db: {
    select: (...args: any[]) => mockSelect(...args),
    delete: (...args: any[]) => mockDelete(...args),
  },
}));

// ── Mock drizzle-orm ─────────────────────────────────────────────────────────
vi.mock("drizzle-orm", () => ({
  eq: vi.fn((a: any, b: any) => ({ field: a, value: b })),
  and: vi.fn((...args: any[]) => args),
  count: vi.fn(() => "count_agg"),
  sql: vi.fn(),
  relations: vi.fn(() => ({})),
}));

// ── Mock db schemas ──────────────────────────────────────────────────────────
vi.mock("../../src/db/schema/memory.js", () => ({
  memories: {
    id: "id",
    userId: "userId",
    content: "content",
  },
  memoryBackends: {
    id: "id",
    userId: "userId",
    type: "type",
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

// ── Mock memoryCompaction service ────────────────────────────────────────────
const mockCompact = vi.fn();
vi.mock("../../src/services/memoryCompaction.service.js", () => ({
  compact: (...args: any[]) => mockCompact(...args),
}));

// ── Mock memoryRouter service ────────────────────────────────────────────────
const mockGetBackend = vi.fn();
const mockSetBackend = vi.fn();
const mockRemoveBackend = vi.fn();
const mockEncryptConfig = vi.fn();
vi.mock("../../src/services/memoryRouter.service.js", () => ({
  getBackend: (...args: any[]) => mockGetBackend(...args),
  setBackend: (...args: any[]) => mockSetBackend(...args),
  removeBackend: (...args: any[]) => mockRemoveBackend(...args),
  encryptConfig: (...args: any[]) => mockEncryptConfig(...args),
}));

// ── Mock sessionSummary service ──────────────────────────────────────────────
const mockSummarizeSession = vi.fn();
vi.mock("../../src/services/sessionSummary.service.js", () => ({
  summarizeSession: (...args: any[]) => mockSummarizeSession(...args),
}));

// ── Mock logger ──────────────────────────────────────────────────────────────
vi.mock("../../src/lib/logger.js", () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import { AppError } from "../../src/middleware/errorHandler.js";
import memoryPlugin from "../../src/routes/memory.js";

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
    headers: {},
    params: {},
    userId: 42,
    ...overrides,
  };
}

// ── Register the plugin once ─────────────────────────────────────────────────
beforeAll(async () => {
  await memoryPlugin(mockFastify as any, {});
});

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("memory routes – registration", () => {
  it("registers all expected routes", () => {
    expect(routes["POST /compact"]).toBeDefined();
    expect(routes["GET /stats"]).toBeDefined();
    expect(routes["DELETE /all"]).toBeDefined();
    expect(routes["GET /backend"]).toBeDefined();
    expect(routes["POST /backend"]).toBeDefined();
    expect(routes["DELETE /backend"]).toBeDefined();
    expect(routes["POST /summarize/:conversationId"]).toBeDefined();
  });

  it("applies auth preHandler to all routes", () => {
    for (const key of Object.keys(routes)) {
      expect(routes[key].opts?.preHandler).toBeDefined();
    }
  });
});

// ── POST /compact ────────────────────────────────────────────────────────────
describe("POST /compact", () => {
  it("calls compact with the user ID and returns the result", async () => {
    const compactionResult = { compacted: 10, remaining: 5 };
    mockCompact.mockResolvedValue(compactionResult);

    const req = createMockRequest({ userId: 42 });
    const reply = createMockReply();
    const result = await routes["POST /compact"].handler(req, reply);

    expect(mockCompact).toHaveBeenCalledWith(42);
    expect(result).toEqual(compactionResult);
  });

  it("propagates errors from compact service", async () => {
    mockCompact.mockRejectedValue(new Error("compaction failed"));

    const req = createMockRequest();
    const reply = createMockReply();

    await expect(routes["POST /compact"].handler(req, reply)).rejects.toThrow("compaction failed");
  });
});

// ── GET /stats ───────────────────────────────────────────────────────────────
describe("GET /stats", () => {
  it("returns chunk count and estimated storage", async () => {
    mockSelectWhere.mockResolvedValue([{ value: 100 }]);

    const req = createMockRequest({ userId: 42 });
    const reply = createMockReply();
    const result = await routes["GET /stats"].handler(req, reply);

    expect(mockSelect).toHaveBeenCalled();
    expect(result).toEqual({
      chunkCount: 100,
      // 100 * 512 * 4 = 204800 bytes = 0.2 MB (after rounding)
      estimatedStorageMB: 0.2,
    });
  });

  it("returns zero stats when no memories exist", async () => {
    mockSelectWhere.mockResolvedValue([{ value: 0 }]);

    const req = createMockRequest({ userId: 42 });
    const reply = createMockReply();
    const result = await routes["GET /stats"].handler(req, reply);

    expect(result).toEqual({
      chunkCount: 0,
      estimatedStorageMB: 0,
    });
  });

  it("propagates db errors", async () => {
    mockSelectWhere.mockRejectedValue(new Error("db error"));

    const req = createMockRequest();
    const reply = createMockReply();

    await expect(routes["GET /stats"].handler(req, reply)).rejects.toThrow("db error");
  });
});

// ── DELETE /all ──────────────────────────────────────────────────────────────
describe("DELETE /all", () => {
  it("deletes all memories when confirmation is correct", async () => {
    mockReturning.mockResolvedValue([{ id: 1 }, { id: 2 }, { id: 3 }]);

    const req = createMockRequest({ body: { confirm: "DELETE_ALL_MEMORY" }, userId: 42 });
    const reply = createMockReply();
    const result = await routes["DELETE /all"].handler(req, reply);

    expect(mockDelete).toHaveBeenCalled();
    expect(result).toEqual({ success: true, deleted: 3 });
  });

  it("returns deleted: 0 when no memories exist", async () => {
    mockReturning.mockResolvedValue([]);

    const req = createMockRequest({ body: { confirm: "DELETE_ALL_MEMORY" }, userId: 42 });
    const reply = createMockReply();
    const result = await routes["DELETE /all"].handler(req, reply);

    expect(result).toEqual({ success: true, deleted: 0 });
  });

  it("throws AppError 400 when confirm is missing", async () => {
    const req = createMockRequest({ body: {} });
    const reply = createMockReply();

    await expect(routes["DELETE /all"].handler(req, reply)).rejects.toThrow(AppError);
    try {
      await routes["DELETE /all"].handler(req, reply);
    } catch (e: any) {
      expect(e.statusCode).toBe(400);
      expect(e.code).toBe("CONFIRM_REQUIRED");
    }
  });

  it("throws AppError 400 when confirm value is wrong", async () => {
    const req = createMockRequest({ body: { confirm: "wrong" } });
    const reply = createMockReply();

    await expect(routes["DELETE /all"].handler(req, reply)).rejects.toThrow(
      "Must confirm with DELETE_ALL_MEMORY",
    );
  });

  it("propagates db errors from delete", async () => {
    mockReturning.mockRejectedValue(new Error("delete failed"));

    const req = createMockRequest({ body: { confirm: "DELETE_ALL_MEMORY" } });
    const reply = createMockReply();

    await expect(routes["DELETE /all"].handler(req, reply)).rejects.toThrow("delete failed");
  });
});

// ── GET /backend ─────────────────────────────────────────────────────────────
describe("GET /backend", () => {
  it("returns local type when no backend is configured", async () => {
    mockGetBackend.mockResolvedValue(null);

    const req = createMockRequest({ userId: 42 });
    const reply = createMockReply();
    const result = await routes["GET /backend"].handler(req, reply);

    expect(mockGetBackend).toHaveBeenCalledWith(42);
    expect(result).toEqual({ type: "local", active: true });
  });

  it("returns safe backend config with hasApiKey true when key exists", async () => {
    mockGetBackend.mockResolvedValue({
      type: "qdrant",
      url: "http://qdrant:6333",
      collectionName: "memories",
      apiKey: "secret-key-123",
    });

    const req = createMockRequest({ userId: 42 });
    const reply = createMockReply();
    const result = await routes["GET /backend"].handler(req, reply);

    expect(result).toEqual({
      type: "qdrant",
      url: "http://qdrant:6333",
      collectionName: "memories",
      hasApiKey: true,
      active: true,
    });
    // API key should NOT be exposed
    expect(result.apiKey).toBeUndefined();
  });

  it("returns hasApiKey false when no key is set", async () => {
    mockGetBackend.mockResolvedValue({
      type: "getzep",
      url: "http://zep:8000",
      collectionName: null,
      apiKey: "",
    });

    const req = createMockRequest({ userId: 42 });
    const reply = createMockReply();
    const result = await routes["GET /backend"].handler(req, reply);

    expect(result).toEqual({
      type: "getzep",
      url: "http://zep:8000",
      collectionName: null,
      hasApiKey: false,
      active: true,
    });
  });

  it("handles backend with null optional fields", async () => {
    mockGetBackend.mockResolvedValue({
      type: "google_drive",
      url: undefined,
      collectionName: undefined,
      apiKey: null,
    });

    const req = createMockRequest({ userId: 42 });
    const reply = createMockReply();
    const result = await routes["GET /backend"].handler(req, reply);

    expect(result).toEqual({
      type: "google_drive",
      url: null,
      collectionName: null,
      hasApiKey: false,
      active: true,
    });
  });

  it("propagates errors from getBackend", async () => {
    mockGetBackend.mockRejectedValue(new Error("backend fetch failed"));

    const req = createMockRequest();
    const reply = createMockReply();

    await expect(routes["GET /backend"].handler(req, reply)).rejects.toThrow("backend fetch failed");
  });
});

// ── POST /backend ────────────────────────────────────────────────────────────
describe("POST /backend", () => {
  it("removes backend and returns local when type is local", async () => {
    mockRemoveBackend.mockResolvedValue(undefined);

    const req = createMockRequest({ body: { type: "local" }, userId: 42 });
    const reply = createMockReply();
    const result = await routes["POST /backend"].handler(req, reply);

    expect(mockRemoveBackend).toHaveBeenCalledWith(42);
    expect(mockSetBackend).not.toHaveBeenCalled();
    expect(result).toEqual({ type: "local", active: true });
  });

  it("sets qdrant backend with config", async () => {
    mockSetBackend.mockResolvedValue(undefined);
    const config = { url: "http://qdrant:6333", apiKey: "key" };

    const req = createMockRequest({ body: { type: "qdrant", config }, userId: 42 });
    const reply = createMockReply();
    const result = await routes["POST /backend"].handler(req, reply);

    expect(mockSetBackend).toHaveBeenCalledWith(42, "qdrant", config);
    expect(result).toEqual({ type: "qdrant", active: true });
  });

  it("sets getzep backend with empty config when none provided", async () => {
    mockSetBackend.mockResolvedValue(undefined);

    const req = createMockRequest({ body: { type: "getzep" }, userId: 42 });
    const reply = createMockReply();
    const result = await routes["POST /backend"].handler(req, reply);

    expect(mockSetBackend).toHaveBeenCalledWith(42, "getzep", {});
    expect(result).toEqual({ type: "getzep", active: true });
  });

  it("sets google_drive backend", async () => {
    mockSetBackend.mockResolvedValue(undefined);

    const req = createMockRequest({ body: { type: "google_drive", config: { folderId: "abc" } }, userId: 42 });
    const reply = createMockReply();
    const result = await routes["POST /backend"].handler(req, reply);

    expect(mockSetBackend).toHaveBeenCalledWith(42, "google_drive", { folderId: "abc" });
    expect(result).toEqual({ type: "google_drive", active: true });
  });

  it("throws AppError 400 for invalid backend type", async () => {
    const req = createMockRequest({ body: { type: "invalid_type" } });
    const reply = createMockReply();

    await expect(routes["POST /backend"].handler(req, reply)).rejects.toThrow(AppError);
    try {
      await routes["POST /backend"].handler(req, reply);
    } catch (e: any) {
      expect(e.statusCode).toBe(400);
      expect(e.code).toBe("INVALID_BACKEND_TYPE");
      expect(e.message).toContain("local, qdrant, getzep, google_drive");
    }
  });

  it("propagates errors from setBackend", async () => {
    mockSetBackend.mockRejectedValue(new Error("set failed"));

    const req = createMockRequest({ body: { type: "qdrant", config: {} } });
    const reply = createMockReply();

    await expect(routes["POST /backend"].handler(req, reply)).rejects.toThrow("set failed");
  });

  it("propagates errors from removeBackend on local type", async () => {
    mockRemoveBackend.mockRejectedValue(new Error("remove failed"));

    const req = createMockRequest({ body: { type: "local" } });
    const reply = createMockReply();

    await expect(routes["POST /backend"].handler(req, reply)).rejects.toThrow("remove failed");
  });
});

// ── DELETE /backend ──────────────────────────────────────────────────────────
describe("DELETE /backend", () => {
  it("removes backend and returns local", async () => {
    mockRemoveBackend.mockResolvedValue(undefined);

    const req = createMockRequest({ userId: 42 });
    const reply = createMockReply();
    const result = await routes["DELETE /backend"].handler(req, reply);

    expect(mockRemoveBackend).toHaveBeenCalledWith(42);
    expect(result).toEqual({ type: "local", active: true });
  });

  it("propagates errors from removeBackend", async () => {
    mockRemoveBackend.mockRejectedValue(new Error("remove error"));

    const req = createMockRequest();
    const reply = createMockReply();

    await expect(routes["DELETE /backend"].handler(req, reply)).rejects.toThrow("remove error");
  });
});

// ── POST /summarize/:conversationId ──────────────────────────────────────────
describe("POST /summarize/:conversationId", () => {
  beforeEach(() => {
    // The summarize handler calls db.select().from().where().limit(1)
    mockSelectWhere.mockReturnValue({ limit: mockSelectLimit });
    mockSelectLimit.mockResolvedValue([{ id: "conv-123" }]);
  });

  it("summarizes the given conversation", async () => {
    const summaryData = { topic: "AI", keyPoints: ["point1"] };
    mockSummarizeSession.mockResolvedValue(summaryData);

    const req = createMockRequest({
      params: { conversationId: "conv-123" },
      userId: 42,
    });
    const reply = createMockReply();
    const result = await routes["POST /summarize/:conversationId"].handler(req, reply);

    expect(mockSummarizeSession).toHaveBeenCalledWith("conv-123", 42);
    expect(result).toEqual({ summary: summaryData });
  });

  it("converts numeric conversationId to string", async () => {
    mockSummarizeSession.mockResolvedValue({ topic: "test" });

    const req = createMockRequest({
      params: { conversationId: 456 },
      userId: 42,
    });
    const reply = createMockReply();
    await routes["POST /summarize/:conversationId"].handler(req, reply);

    expect(mockSummarizeSession).toHaveBeenCalledWith("456", 42);
  });

  it("propagates errors from summarizeSession", async () => {
    mockSummarizeSession.mockRejectedValue(new Error("summarize failed"));

    const req = createMockRequest({ params: { conversationId: "conv-1" } });
    const reply = createMockReply();

    await expect(routes["POST /summarize/:conversationId"].handler(req, reply)).rejects.toThrow(
      "summarize failed",
    );
  });
});
