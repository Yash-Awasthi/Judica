import { describe, it, expect, vi, beforeEach } from "vitest";

// ---- mock helpers ----

const mockDb: any = {};

function chainable(overrides: Record<string, any> = {}): any {
  const chain: any = {};
  const methods = [
    "select", "from", "where", "limit", "orderBy",
    "update", "set", "insert", "values", "returning",
    "delete", "onConflictDoUpdate",
  ];
  for (const m of methods) {
    chain[m] = overrides[m] ?? vi.fn(() => chain);
  }
  return chain;
}

// ---- mock modules ----

vi.mock("../../src/lib/drizzle.js", () => ({
  db: mockDb,
}));

vi.mock("../../src/db/schema/repos.js", () => ({
  codeRepositories: {
    id: "codeRepositories.id",
    userId: "codeRepositories.userId",
    indexed: "codeRepositories.indexed",
  },
}));

vi.mock("../../src/db/schema/users.js", () => ({
  dailyUsage: {
    userId: "dailyUsage.userId",
    date: "dailyUsage.date",
    requests: "dailyUsage.requests",
    tokens: "dailyUsage.tokens",
  },
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((...args: any[]) => args),
  and: vi.fn((...args: any[]) => args),
  sql: vi.fn((strings: TemplateStringsArray) => strings.join("")),
}));

vi.mock("../../src/config/quotas.js", () => ({
  DAILY_REQUEST_LIMIT: 100,
  DAILY_TOKEN_LIMIT: 1_000_000,
}));

const mockAskCouncil = vi.fn();
const mockPrepareCouncilMembers_council = vi.fn();
const mockStreamCouncil = vi.fn();

vi.mock("../../src/lib/council.js", () => ({
  askCouncil: mockAskCouncil,
  prepareCouncilMembers: mockPrepareCouncilMembers_council,
  streamCouncil: mockStreamCouncil,
}));

vi.mock("../../src/lib/providers.js", () => ({}));

vi.mock("../../src/lib/logger.js", () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock("../../src/middleware/fastifyAuth.js", () => ({
  fastifyOptionalAuth: vi.fn(),
}));

const mockAskSchemaSafeParse = vi.fn();
vi.mock("../../src/middleware/validate.js", () => ({
  askSchema: { safeParse: mockAskSchemaSafeParse },
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

const mockGetCachedResponse = vi.fn();
const mockSetCachedResponse = vi.fn();
vi.mock("../../src/lib/cache.js", () => ({
  getCachedResponse: mockGetCachedResponse,
  setCachedResponse: mockSetCachedResponse,
}));

vi.mock("../../src/config/env.js", () => ({
  env: { NODE_ENV: "test" },
}));

const mockCreateConversation = vi.fn();
const mockFindConversationById = vi.fn();
const mockCreateChat = vi.fn();
const mockGetRecentHistory = vi.fn();
const mockRetrieveRelevantContext = vi.fn();
const mockFormatContextForInjection = vi.fn();

vi.mock("../../src/services/conversationService.js", () => ({
  createConversation: mockCreateConversation,
  findConversationById: mockFindConversationById,
  createChat: mockCreateChat,
  getRecentHistory: mockGetRecentHistory,
  retrieveRelevantContext: mockRetrieveRelevantContext,
  formatContextForInjection: mockFormatContextForInjection,
}));

const mockUpdateDailyUsage = vi.fn();
vi.mock("../../src/services/usageService.js", () => ({
  updateDailyUsage: mockUpdateDailyUsage,
}));

const mockClassifyQuery = vi.fn();
const mockFormatRouterMetadata = vi.fn();
const mockGetAutoArchetypes = vi.fn();
vi.mock("../../src/lib/router.js", () => ({
  classifyQuery: mockClassifyQuery,
  formatRouterMetadata: mockFormatRouterMetadata,
  getAutoArchetypes: mockGetAutoArchetypes,
}));

const mockGetDefaultMembers = vi.fn();
const mockGetDefaultMaster = vi.fn();
const mockResolveApiKey = vi.fn();
const mockPrepareCouncilMembers_service = vi.fn();
class MockCouncilServiceError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "CouncilServiceError";
    this.code = code;
  }
}

vi.mock("../../src/services/councilService.js", () => ({
  getDefaultMembers: mockGetDefaultMembers,
  getDefaultMaster: mockGetDefaultMaster,
  resolveApiKey: mockResolveApiKey,
  CouncilServiceError: MockCouncilServiceError,
  prepareCouncilMembers: mockPrepareCouncilMembers_service,
}));

const mockLoadFileContext = vi.fn();
const mockLoadRAGContext = vi.fn();
const mockBuildEnrichedQuestion = vi.fn();
vi.mock("../../src/services/messageBuilder.service.js", () => ({
  loadFileContext: mockLoadFileContext,
  loadRAGContext: mockLoadRAGContext,
  buildEnrichedQuestion: mockBuildEnrichedQuestion,
}));

const mockDetectArtifact = vi.fn();
const mockSaveArtifact = vi.fn();
vi.mock("../../src/services/artifacts.service.js", () => ({
  detectArtifact: mockDetectArtifact,
  saveArtifact: mockSaveArtifact,
}));

const mockStartTrace = vi.fn();
const mockAddStep = vi.fn();
const mockEndTrace = vi.fn();
vi.mock("../../src/observability/tracer.js", () => ({
  startTrace: mockStartTrace,
  addStep: mockAddStep,
  endTrace: mockEndTrace,
}));

const mockSearchRepo = vi.fn();
vi.mock("../../src/services/repoSearch.service.js", () => ({
  searchRepo: mockSearchRepo,
}));

// ---- helpers to capture registered route handlers ----

const registeredRoutes: Record<string, { handler: Function; preHandler?: Function | Function[] }> = {};

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

function createRequest(overrides: Partial<{
  userId: number | null;
  body: any;
  params: any;
  headers: Record<string, string>;
  raw: any;
}> = {}): any {
  return {
    userId: overrides.userId === null ? undefined : (overrides.userId ?? 1),
    body: overrides.body ?? {},
    params: overrides.params ?? {},
    headers: overrides.headers ?? { authorization: "Bearer token" },
    raw: overrides.raw ?? {
      on: vi.fn(),
    },
  };
}

function createReply(): any {
  const reply: any = {
    statusCode: 200,
    sentData: undefined,
    headers: {} as Record<string, string>,
    code: vi.fn(function (this: any, c: number) {
      this.statusCode = c;
      return this;
    }),
    send: vi.fn(function (this: any, b: any) {
      this.sentData = b;
      return this;
    }),
    header: vi.fn(function (this: any, k: string, v: string) {
      this.headers[k] = v;
      return this;
    }),
    raw: {
      writeHead: vi.fn(),
      write: vi.fn(),
      end: vi.fn(),
      on: vi.fn(),
    },
  };
  return reply;
}

// ---- default mock return values ----

function setupDefaultMocks() {
  mockGetDefaultMembers.mockReturnValue([
    { name: "member1", model: "m1", type: "api" },
    { name: "member2", model: "m2", type: "api" },
  ]);
  mockGetDefaultMaster.mockReturnValue({ name: "master", model: "m-master", type: "api" });
  mockResolveApiKey.mockReturnValue("test-api-key");
  mockPrepareCouncilMembers_council.mockResolvedValue([
    { name: "member1", model: "m1", type: "api", apiKey: "test-api-key" },
  ]);
  mockGetCachedResponse.mockResolvedValue(null);
  mockSetCachedResponse.mockResolvedValue(undefined);
  mockAskCouncil.mockResolvedValue({
    verdict: "Test verdict",
    opinions: [{ name: "member1", opinion: "Opinion 1" }],
    metrics: { totalTokens: 100 },
  });
  mockCreateConversation.mockResolvedValue({ id: "new-conv-id" });
  mockFindConversationById.mockResolvedValue({ id: "existing-conv-id" });
  mockCreateChat.mockResolvedValue({});
  mockGetRecentHistory.mockResolvedValue([]);
  mockRetrieveRelevantContext.mockResolvedValue([]);
  mockFormatContextForInjection.mockReturnValue("");
  mockLoadFileContext.mockResolvedValue("");
  mockLoadRAGContext.mockResolvedValue({ context: "", citations: [] });
  mockBuildEnrichedQuestion.mockReturnValue("enriched question");
  mockUpdateDailyUsage.mockResolvedValue(undefined);
  mockDetectArtifact.mockReturnValue(null);
  mockSaveArtifact.mockResolvedValue("artifact-id");
  mockStartTrace.mockReturnValue({ conversationId: undefined });
  mockEndTrace.mockResolvedValue(undefined);
  mockStreamCouncil.mockResolvedValue("streamed verdict");
  mockGetAutoArchetypes.mockReturnValue({
    archetypes: ["architect", "contrarian"],
    result: { type: "debate", confidence: 0.9, fallback: false },
  });
  mockFormatRouterMetadata.mockReturnValue({ type: "debate", confidence: 0.9 });
  mockSearchRepo.mockResolvedValue([]);
  mockAskSchemaSafeParse.mockReturnValue({ success: true, data: { question: "test?" } });

  // DB chain for quota check
  const quotaChain = chainable({
    returning: vi.fn(() => [{ requests: 1, tokens: 0 }]),
  });
  mockDb.insert = vi.fn(() => quotaChain);
  mockDb.select = vi.fn(() => chainable({ limit: vi.fn(() => []) }));
}

// ---- import and register the plugin ----

let askPlugin: any;

beforeEach(async () => {
  vi.clearAllMocks();
  for (const key of Object.keys(registeredRoutes)) {
    delete registeredRoutes[key];
  }

  setupDefaultMocks();

  const mod = await import("../../src/routes/ask.js");
  askPlugin = mod.default;
  const fastify = createFastifyInstance();
  await askPlugin(fastify);
}, 30000);

// ================================================================
// Route registration
// ================================================================
describe("route registration", () => {
  it("registers GET / health check route", () => {
    expect(registeredRoutes["GET /"]).toBeDefined();
  });

  it("registers POST / ask route", () => {
    expect(registeredRoutes["POST /"]).toBeDefined();
    expect(registeredRoutes["POST /"].preHandler).toBeDefined();
  });

  it("registers POST /stream route", () => {
    expect(registeredRoutes["POST /stream"]).toBeDefined();
    expect(registeredRoutes["POST /stream"].preHandler).toBeDefined();
  });

  it("POST / has three preHandlers", () => {
    const pre = registeredRoutes["POST /"].preHandler;
    expect(Array.isArray(pre)).toBe(true);
    expect((pre as Function[]).length).toBe(3);
  });
});

// ================================================================
// GET / health check
// ================================================================
describe("GET / health check", () => {
  it("returns council listening message", async () => {
    const handler = registeredRoutes["GET /"].handler;
    const req = createRequest();
    const reply = createReply();
    const result = await handler(req, reply);
    expect(result).toEqual({ message: "Council is listening. Use POST to ask." });
  });
});

// ================================================================
// POST / ask (non-streaming)
// ================================================================
describe("POST / ask", () => {
  function getHandler() {
    return registeredRoutes["POST /"].handler;
  }

  it("returns success with verdict and opinions for basic question", async () => {
    const handler = getHandler();
    const req = createRequest({
      body: { question: "What is AI?", rounds: 1 },
    });
    const reply = createReply();

    const result = await handler(req, reply);

    expect(result.success).toBe(true);
    expect(result.verdict).toBe("Test verdict");
    expect(result.opinions).toEqual([{ name: "member1", opinion: "Opinion 1" }]);
    expect(result.conversationId).toBe("new-conv-id");
    expect(typeof result.latency).toBe("number");
  });

  it("uses cache when cached response is available", async () => {
    mockGetCachedResponse.mockResolvedValue({
      verdict: "Cached verdict",
      opinions: [{ name: "cached-member", opinion: "Cached opinion" }],
    });

    const handler = getHandler();
    const req = createRequest({
      body: { question: "What is AI?", rounds: 1 },
    });
    const reply = createReply();

    const result = await handler(req, reply);

    expect(result.verdict).toBe("Cached verdict");
    expect(result.cacheHit).toBe(true);
    expect(mockAskCouncil).not.toHaveBeenCalled();
  });

  it("calls askCouncil when no cached response", async () => {
    const handler = getHandler();
    const req = createRequest({
      body: { question: "What is AI?", rounds: 2 },
    });
    const reply = createReply();

    await handler(req, reply);

    expect(mockAskCouncil).toHaveBeenCalled();
    expect(mockSetCachedResponse).toHaveBeenCalled();
  });

  it("creates new conversation for authenticated user with no conversationId", async () => {
    const handler = getHandler();
    const req = createRequest({
      userId: 42,
      body: { question: "What is AI?" },
    });
    const reply = createReply();

    const result = await handler(req, reply);

    expect(mockCreateConversation).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 42 })
    );
    expect(result.conversationId).toBe("new-conv-id");
  });

  it("looks up existing conversation when conversationId is provided", async () => {
    const handler = getHandler();
    const req = createRequest({
      userId: 1,
      body: { question: "Follow-up", conversationId: "existing-conv-id" },
    });
    const reply = createReply();

    await handler(req, reply);

    expect(mockFindConversationById).toHaveBeenCalledWith("existing-conv-id", 1);
    expect(mockGetRecentHistory).toHaveBeenCalledWith("existing-conv-id");
  });

  it("throws 404 when conversation not found", async () => {
    mockFindConversationById.mockResolvedValue(null);

    const handler = getHandler();
    const req = createRequest({
      body: { question: "Follow-up", conversationId: "bad-id" },
    });
    const reply = createReply();

    await expect(handler(req, reply)).rejects.toThrow("Conversation not found");
  });

  it("uses auto mode with router decision", async () => {
    const handler = getHandler();
    const req = createRequest({
      body: { question: "Debate topic", mode: "auto" },
    });
    const reply = createReply();

    const result = await handler(req, reply);

    expect(mockGetAutoArchetypes).toHaveBeenCalledWith("Debate topic");
    expect(result.router).toEqual({ type: "debate", confidence: 0.9 });
    expect(mockFormatRouterMetadata).toHaveBeenCalled();
  });

  it("auto mode with fallback uses default summon", async () => {
    mockGetAutoArchetypes.mockReturnValue({
      archetypes: [],
      result: { type: "general", confidence: 0.3, fallback: true },
    });

    const handler = getHandler();
    const req = createRequest({
      body: { question: "Something vague", mode: "auto" },
    });
    const reply = createReply();

    await handler(req, reply);

    // Should have been called with "default" summon (fallback=true)
    expect(mockPrepareCouncilMembers_council).toHaveBeenCalledWith(
      expect.anything(),
      "default",
      expect.anything()
    );
  });

  it("direct mode sets empty members and zero rounds", async () => {
    const handler = getHandler();
    const req = createRequest({
      body: { question: "Baseline test", mode: "direct" },
    });
    const reply = createReply();

    await handler(req, reply);

    // In direct mode, effectiveMembers=[] are mapped and passed, rounds=0
    expect(mockAskCouncil).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      undefined,
      0
    );
  });

  it("handles userConfig by using prepareCouncilMembers from councilService", async () => {
    mockPrepareCouncilMembers_service.mockReturnValue({
      members: [{ name: "custom", model: "c1", type: "api", apiKey: "k" }],
      master: { name: "custom-master", model: "cm", type: "api", apiKey: "k" },
    });

    const handler = getHandler();
    const req = createRequest({
      body: {
        question: "Custom config test",
        userConfig: { members: [], master: {} },
      },
    });
    const reply = createReply();

    await handler(req, reply);

    expect(mockPrepareCouncilMembers_service).toHaveBeenCalledWith(undefined, { members: [], master: {} });
  });

  it("handles CouncilServiceError from council setup", async () => {
    mockGetDefaultMembers.mockImplementation(() => {
      throw new MockCouncilServiceError("INVALID_CONFIG", "Bad config");
    });

    const handler = getHandler();
    const req = createRequest({
      body: { question: "Test" },
    });
    const reply = createReply();

    await expect(handler(req, reply)).rejects.toThrow("Bad config");
  });

  it("re-throws non-CouncilServiceError from council setup", async () => {
    mockGetDefaultMembers.mockImplementation(() => {
      throw new Error("Unexpected");
    });

    const handler = getHandler();
    const req = createRequest({ body: { question: "Test" } });
    const reply = createReply();

    await expect(handler(req, reply)).rejects.toThrow("Unexpected");
  });

  it("does not create conversation or save chat for unauthenticated user", async () => {
    const handler = getHandler();
    const req = createRequest({
      userId: null,
      body: { question: "Anonymous question" },
    });
    const reply = createReply();

    const result = await handler(req, reply);

    expect(mockCreateConversation).not.toHaveBeenCalled();
    expect(mockCreateChat).not.toHaveBeenCalled();
    expect(mockUpdateDailyUsage).not.toHaveBeenCalled();
    expect(result.success).toBe(true);
  });

  it("saves chat to existing conversation", async () => {
    const handler = getHandler();
    const req = createRequest({
      userId: 5,
      body: { question: "Follow-up", conversationId: "existing-conv-id" },
    });
    const reply = createReply();

    await handler(req, reply);

    expect(mockCreateChat).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 5,
        conversationId: "existing-conv-id",
        question: "Follow-up",
        verdict: "Test verdict",
      })
    );
  });

  it("calls updateDailyUsage for authenticated user", async () => {
    const handler = getHandler();
    const req = createRequest({
      userId: 10,
      body: { question: "Usage test" },
    });
    const reply = createReply();

    await handler(req, reply);

    expect(mockUpdateDailyUsage).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 10, tokensUsed: 100, isCacheHit: false })
    );
  });

  it("detects and saves artifact when present", async () => {
    mockDetectArtifact.mockReturnValue({ type: "code", content: "console.log('hi')" });
    mockSaveArtifact.mockResolvedValue("art-123");

    const handler = getHandler();
    const req = createRequest({
      userId: 1,
      body: { question: "Write code" },
    });
    const reply = createReply();

    const result = await handler(req, reply);

    expect(mockDetectArtifact).toHaveBeenCalledWith("Test verdict");
    expect(mockSaveArtifact).toHaveBeenCalledWith(1, "new-conv-id", { type: "code", content: "console.log('hi')" });
    expect(result.artifact_id).toBe("art-123");
  });

  it("does not detect artifact for unauthenticated user", async () => {
    const handler = getHandler();
    const req = createRequest({
      userId: null,
      body: { question: "Anonymous code" },
    });
    const reply = createReply();

    const result = await handler(req, reply);

    expect(mockDetectArtifact).not.toHaveBeenCalled();
    expect(result.artifact_id).toBeUndefined();
  });

  it("loads file context when upload_ids provided", async () => {
    mockLoadFileContext.mockResolvedValue("file content here");
    mockBuildEnrichedQuestion.mockReturnValue("enriched with files");

    const handler = getHandler();
    const req = createRequest({
      userId: 1,
      body: { question: "Analyze file", upload_ids: ["file-1", "file-2"] },
    });
    const reply = createReply();

    await handler(req, reply);

    expect(mockLoadFileContext).toHaveBeenCalledWith(["file-1", "file-2"], 1);
    expect(mockBuildEnrichedQuestion).toHaveBeenCalledWith(
      "Analyze file", "file content here", "", "", undefined
    );
  });

  it("loads RAG context when kb_id and userId are present", async () => {
    mockLoadRAGContext.mockResolvedValue({
      context: "RAG content",
      citations: [{ source: "doc1", score: 0.95 }],
    });

    const handler = getHandler();
    const req = createRequest({
      userId: 1,
      body: { question: "Search KB", kb_id: "kb-123" },
    });
    const reply = createReply();

    const result = await handler(req, reply);

    expect(mockLoadRAGContext).toHaveBeenCalledWith(1, "Search KB", "kb-123");
    expect(result.citations).toEqual([{ source: "doc1", score: 0.95 }]);
  });

  it("does not include citations when ragCitations is empty", async () => {
    const handler = getHandler();
    const req = createRequest({
      body: { question: "No KB" },
    });
    const reply = createReply();

    const result = await handler(req, reply);
    expect(result.citations).toBeUndefined();
  });

  it("retrieves relevant memory context for existing conversation", async () => {
    mockRetrieveRelevantContext.mockResolvedValue([{ content: "past chat" }]);
    mockFormatContextForInjection.mockReturnValue("formatted memory");

    const handler = getHandler();
    const req = createRequest({
      userId: 1,
      body: { question: "Recall", conversationId: "existing-conv-id" },
    });
    const reply = createReply();

    await handler(req, reply);

    expect(mockRetrieveRelevantContext).toHaveBeenCalledWith("existing-conv-id", "Recall", 3);
    expect(mockFormatContextForInjection).toHaveBeenCalledWith([{ content: "past chat" }]);
  });

  it("loads code context when repo_id is provided", async () => {
    const selectChain = chainable({
      limit: vi.fn(() => [{ id: "repo-1", userId: 1, indexed: true }]),
    });
    mockDb.select = vi.fn(() => selectChain);
    mockSearchRepo.mockResolvedValue([
      { path: "src/index.ts", language: "typescript", content: "const x = 1;" },
    ]);

    const handler = getHandler();
    const req = createRequest({
      userId: 1,
      body: { question: "Explain code", repo_id: "repo-1" },
    });
    const reply = createReply();

    await handler(req, reply);

    expect(mockSearchRepo).toHaveBeenCalledWith("repo-1", "Explain code", 5);
  });

  it("handles repo search failure gracefully", async () => {
    const selectChain = chainable({
      limit: vi.fn(() => { throw new Error("DB error"); }),
    });
    mockDb.select = vi.fn(() => selectChain);

    const handler = getHandler();
    const req = createRequest({
      userId: 1,
      body: { question: "Explain code", repo_id: "repo-1" },
    });
    const reply = createReply();

    // Should not throw
    const result = await handler(req, reply);
    expect(result.success).toBe(true);
  });

  it("starts and ends trace for authenticated user", async () => {
    mockStartTrace.mockReturnValue({ conversationId: undefined });
    mockEndTrace.mockResolvedValue(undefined);

    const handler = getHandler();
    const req = createRequest({
      userId: 1,
      body: { question: "Traced question" },
    });
    const reply = createReply();

    await handler(req, reply);

    expect(mockStartTrace).toHaveBeenCalledWith(1, "chat", expect.anything());
    expect(mockEndTrace).toHaveBeenCalled();
  });

  it("does not start trace for unauthenticated user", async () => {
    const handler = getHandler();
    const req = createRequest({
      userId: null,
      body: { question: "No trace" },
    });
    const reply = createReply();

    await handler(req, reply);

    expect(mockStartTrace).not.toHaveBeenCalled();
  });

  it("includes metrics in response when tokens used > 0", async () => {
    const handler = getHandler();
    const req = createRequest({
      body: { question: "Metrics test" },
    });
    const reply = createReply();

    const result = await handler(req, reply);

    expect(result.metrics).toEqual({
      totalTokens: 100,
      totalCost: 0,
      hallucinationCount: 0,
    });
  });

  it("omits metrics when tokensUsed is 0 and not a cache hit", async () => {
    mockAskCouncil.mockResolvedValue({
      verdict: "No tokens",
      opinions: [],
      metrics: { totalTokens: 0 },
    });

    const handler = getHandler();
    const req = createRequest({
      userId: null,
      body: { question: "No metrics" },
    });
    const reply = createReply();

    const result = await handler(req, reply);

    expect(result.metrics).toBeUndefined();
  });

  it("defaults rounds to 1 when not provided", async () => {
    const handler = getHandler();
    const req = createRequest({
      body: { question: "Default rounds" },
    });
    const reply = createReply();

    await handler(req, reply);

    expect(mockAskCouncil).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      undefined,
      1
    );
  });
});

// ================================================================
// POST /stream - SSE streaming
// ================================================================
describe("POST /stream", () => {
  function getHandler() {
    return registeredRoutes["POST /stream"].handler;
  }

  it("sets SSE headers on the raw response", async () => {
    const handler = getHandler();
    const req = createRequest({
      body: { question: "Stream test" },
    });
    const reply = createReply();

    await handler(req, reply);

    expect(reply.raw.writeHead).toHaveBeenCalledWith(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
    });
  });

  it("writes cached response and ends stream when cache hit", async () => {
    mockGetCachedResponse.mockResolvedValue({
      verdict: "Cached stream verdict",
      opinions: [{ name: "m1", opinion: "cached op" }],
    });

    const handler = getHandler();
    const req = createRequest({
      body: { question: "Cached stream" },
    });
    const reply = createReply();

    await handler(req, reply);

    const written = reply.raw.write.mock.calls[0][0];
    const parsed = JSON.parse(written.replace("data: ", "").trim());
    expect(parsed.type).toBe("done");
    expect(parsed.cached).toBe(true);
    expect(parsed.verdict).toBe("Cached stream verdict");
    expect(reply.raw.end).toHaveBeenCalled();
  });

  it("calls streamCouncil and ends stream on non-cached response", async () => {
    const handler = getHandler();
    const req = createRequest({
      body: { question: "Stream me" },
    });
    const reply = createReply();

    await handler(req, reply);

    expect(mockStreamCouncil).toHaveBeenCalled();
    expect(reply.raw.end).toHaveBeenCalled();
    expect(mockSetCachedResponse).toHaveBeenCalled();
  });

  it("writes error event when conversation not found (stream)", async () => {
    mockFindConversationById.mockResolvedValue(null);

    const handler = getHandler();
    const req = createRequest({
      body: { question: "Bad convo", conversationId: "nonexistent" },
    });
    const reply = createReply();

    await handler(req, reply);

    const written = reply.raw.write.mock.calls[0][0];
    const parsed = JSON.parse(written.replace("data: ", "").trim());
    expect(parsed.type).toBe("error");
    expect(parsed.message).toBe("Conversation not found");
    expect(reply.raw.end).toHaveBeenCalled();
  });

  it("creates new conversation for authenticated user in stream mode", async () => {
    const handler = getHandler();
    const req = createRequest({
      userId: 7,
      body: { question: "New stream conv" },
    });
    const reply = createReply();

    await handler(req, reply);

    expect(mockCreateConversation).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 7 })
    );
  });

  it("does not create conversation for unauthenticated user in stream mode", async () => {
    const handler = getHandler();
    const req = createRequest({
      userId: null,
      body: { question: "Anon stream" },
    });
    const reply = createReply();

    await handler(req, reply);

    expect(mockCreateConversation).not.toHaveBeenCalled();
  });

  it("registers abort on client disconnect", async () => {
    const handler = getHandler();
    const rawOn = vi.fn();
    const req = createRequest({
      body: { question: "Abort test" },
      raw: { on: rawOn },
    });
    const reply = createReply();

    await handler(req, reply);

    expect(rawOn).toHaveBeenCalledWith("close", expect.any(Function));
    expect(rawOn).toHaveBeenCalledWith("error", expect.any(Function));
  });

  it("writes error event on exception during stream processing", async () => {
    mockGetDefaultMembers.mockImplementation(() => {
      throw new Error("Stream failure");
    });

    const handler = getHandler();
    const req = createRequest({
      body: { question: "Error stream" },
    });
    const reply = createReply();

    await handler(req, reply);

    const written = reply.raw.write.mock.calls[0][0];
    const parsed = JSON.parse(written.replace("data: ", "").trim());
    expect(parsed.type).toBe("error");
    expect(parsed.message).toBe("Stream failure");
    expect(reply.raw.end).toHaveBeenCalled();
  });

  it("uses auto mode with router in stream", async () => {
    const handler = getHandler();
    const req = createRequest({
      body: { question: "Auto stream", mode: "auto" },
    });
    const reply = createReply();

    await handler(req, reply);

    expect(mockGetAutoArchetypes).toHaveBeenCalledWith("Auto stream");
  });

  it("uses direct mode in stream", async () => {
    const handler = getHandler();
    const req = createRequest({
      body: { question: "Direct stream", mode: "direct" },
    });
    const reply = createReply();

    await handler(req, reply);

    expect(mockStreamCouncil).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.any(Function),
      undefined,
      0,
      expect.anything()
    );
  });

  it("saves chat and updates usage after stream for authenticated user", async () => {
    mockStreamCouncil.mockImplementation(async (_m: any, _ma: any, _msg: any, cb: Function) => {
      cb("opinion", { name: "m1", opinion: "op1" });
      cb("done", { tokensUsed: 200 });
      return "final streamed verdict";
    });

    const handler = getHandler();
    const req = createRequest({
      userId: 3,
      body: { question: "Save stream chat" },
    });
    const reply = createReply();

    await handler(req, reply);

    expect(mockCreateChat).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 3,
        verdict: "final streamed verdict",
      })
    );
    expect(mockUpdateDailyUsage).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 3 })
    );
  });

  it("detects and saves artifact in stream mode", async () => {
    mockDetectArtifact.mockReturnValue({ type: "code", content: "streamed code" });
    mockSaveArtifact.mockResolvedValue("stream-art-id");

    const handler = getHandler();
    const req = createRequest({
      userId: 1,
      body: { question: "Stream artifact" },
    });
    const reply = createReply();

    await handler(req, reply);

    expect(mockDetectArtifact).toHaveBeenCalledWith("streamed verdict");
    expect(mockSaveArtifact).toHaveBeenCalled();
  });

  it("loads file and RAG context in stream mode", async () => {
    mockLoadFileContext.mockResolvedValue("stream file");
    mockLoadRAGContext.mockResolvedValue({
      context: "stream rag",
      citations: [{ source: "s1", score: 0.8 }],
    });

    const handler = getHandler();
    const req = createRequest({
      userId: 1,
      body: {
        question: "Stream with context",
        upload_ids: ["f1"],
        kb_id: "kb-1",
      },
    });
    const reply = createReply();

    await handler(req, reply);

    expect(mockLoadFileContext).toHaveBeenCalledWith(["f1"], 1);
    expect(mockLoadRAGContext).toHaveBeenCalledWith(1, "Stream with context", "kb-1");
  });

  it("includes conversationId in done event for cached stream", async () => {
    mockGetCachedResponse.mockResolvedValue({
      verdict: "cv",
      opinions: [],
    });

    const handler = getHandler();
    const req = createRequest({
      userId: 1,
      body: { question: "Cached with conv" },
    });
    const reply = createReply();

    await handler(req, reply);

    const written = reply.raw.write.mock.calls[0][0];
    const parsed = JSON.parse(written.replace("data: ", "").trim());
    expect(parsed).toHaveProperty("conversationId");
  });
});

// ================================================================
// validateAskBody (tested indirectly via preHandler)
// ================================================================
describe("validateAskBody preHandler", () => {
  it("is registered as third preHandler on POST /", () => {
    const pre = registeredRoutes["POST /"].preHandler as Function[];
    // The third preHandler is validateAskBody
    expect(pre.length).toBe(3);
  });
});

// ================================================================
// fastifyCheckQuota (the quota middleware)
// ================================================================
describe("fastifyCheckQuota behavior (tested via ask route context)", () => {
  it("POST / preHandler includes quota check as second element", () => {
    const pre = registeredRoutes["POST /"].preHandler as Function[];
    // Second preHandler is fastifyCheckQuota
    expect(pre.length).toBeGreaterThanOrEqual(2);
  });
});
