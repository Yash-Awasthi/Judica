import { describe, it, expect, vi, beforeEach } from "vitest";

// ── DB chain factory ────────────────────────────────────────────────────────

function createChain(resolvedValue: any = []) {
  const chain: any = {};
  const methods = ["from", "where", "orderBy", "offset", "limit", "set", "values", "returning"];
  for (const m of methods) {
    chain[m] = vi.fn(() => chain);
  }
  // Make the chain awaitable (thenable)
  chain.then = (resolve: any, reject?: any) => Promise.resolve(resolvedValue).then(resolve, reject);
  return chain;
}

let selectQueue: any[];
let insertQueue: any[];
let updateQueue: any[];

const mockDb: any = {
  select: vi.fn((...args: any[]) => {
    return selectQueue.shift() || createChain([]);
  }),
  insert: vi.fn((...args: any[]) => {
    return insertQueue.shift() || createChain([]);
  }),
  update: vi.fn((...args: any[]) => {
    return updateQueue.shift() || createChain([]);
  }),
};

vi.mock("../../src/lib/drizzle.js", () => ({ db: mockDb }));

vi.mock("../../src/services/conversationService.js", () => ({
  getConversationList: vi.fn().mockResolvedValue([]),
  deleteConversation: vi.fn().mockResolvedValue(true),
  updateConversationTitle: vi.fn().mockResolvedValue(true),
}));

vi.mock("../../src/db/schema/conversations.js", () => ({
  conversations: {
    id: "id",
    userId: "userId",
    title: "title",
    isPublic: "isPublic",
    updatedAt: "updatedAt",
  },
  chats: {
    id: "id",
    conversationId: "conversationId",
    userId: "userId",
    question: "question",
    verdict: "verdict",
    opinions: "opinions",
    createdAt: "createdAt",
  },
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((...a: any[]) => ["eq", ...a]),
  and: vi.fn((...a: any[]) => ["and", ...a]),
  or: vi.fn((...a: any[]) => ["or", ...a]),
  ilike: vi.fn((...a: any[]) => ["ilike", ...a]),
  asc: vi.fn((col: any) => ["asc", col]),
  desc: vi.fn((col: any) => ["desc", col]),
  count: vi.fn(() => "count"),
  lte: vi.fn((...a: any[]) => ["lte", ...a]),
  sql: vi.fn(),
}));

vi.mock("../../src/middleware/fastifyAuth.js", () => ({
  fastifyRequireAuth: vi.fn(),
}));

vi.mock("../../src/middleware/validate.js", () => ({
  fastifyValidate: vi.fn(() => vi.fn()),
  renameConversationSchema: {},
  forkSchema: {},
}));

vi.mock("../../src/middleware/errorHandler.js", () => ({
  AppError: class AppError extends Error {
    statusCode: number;
    constructor(statusCode: number, message: string) {
      super(message);
      this.statusCode = statusCode;
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

// ── Route-capture helper ────────────────────────────────────────────────────

const routes: Record<string, any> = {};

const mockFastify = {
  get: vi.fn((path: string, opts: any, handler?: any) => {
    routes[`GET ${path}`] = { handler: handler || opts, opts: handler ? opts : undefined };
  }),
  post: vi.fn((path: string, opts: any, handler?: any) => {
    routes[`POST ${path}`] = { handler: handler || opts, opts: handler ? opts : undefined };
  }),
  patch: vi.fn((path: string, opts: any, handler?: any) => {
    routes[`PATCH ${path}`] = { handler: handler || opts, opts: handler ? opts : undefined };
  }),
  delete: vi.fn((path: string, opts: any, handler?: any) => {
    routes[`DELETE ${path}`] = { handler: handler || opts, opts: handler ? opts : undefined };
  }),
};

// ── Helpers ─────────────────────────────────────────────────────────────────

function makeRequest(overrides: Record<string, any> = {}): any {
  return { userId: 1, query: {}, params: {}, body: {}, ...overrides };
}

function makeReply(): any {
  return { code: vi.fn().mockReturnThis(), send: vi.fn().mockReturnThis() };
}

import {
  getConversationList,
  deleteConversation,
  updateConversationTitle,
} from "../../src/services/conversationService.js";

describe("History Routes", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    selectQueue = [];
    insertQueue = [];
    updateQueue = [];

    // Re-register routes
    Object.keys(routes).forEach((k) => delete routes[k]);
    const mod = await import("../../src/routes/history.js");
    await (mod.default as any)(mockFastify as any);
  });

  // ── GET /search ─────────────────────────────────────────────────────────

  describe("GET /search", () => {
    const handler = () => routes["GET /search"].handler;

    it("registers with preHandler for auth", () => {
      expect(routes["GET /search"].opts).toBeDefined();
      expect(routes["GET /search"].opts.preHandler).toBeDefined();
    });

    it("returns empty array when q is missing", async () => {
      const result = await handler()(makeRequest({ query: {} }), makeReply());
      expect(result).toEqual([]);
    });

    it("returns empty array when q is too short", async () => {
      const result = await handler()(makeRequest({ query: { q: "a" } }), makeReply());
      expect(result).toEqual([]);
    });

    it("returns empty array when q is empty string", async () => {
      const result = await handler()(makeRequest({ query: { q: "" } }), makeReply());
      expect(result).toEqual([]);
    });

    it("escapes LIKE wildcard characters in the search term", async () => {
      const { ilike } = await import("drizzle-orm");
      const mockResults = [{ id: 1, conversationId: "c1", question: "100% done", verdict: "ok", createdAt: new Date() }];
      selectQueue.push(createChain(mockResults));

      const result = await handler()(makeRequest({ query: { q: "100% _test\\" } }), makeReply());

      expect(result).toEqual(mockResults);
      expect(ilike).toHaveBeenCalledWith(expect.anything(), expect.stringContaining("\\%"));
      expect(ilike).toHaveBeenCalledWith(expect.anything(), expect.stringContaining("\\_"));
      expect(ilike).toHaveBeenCalledWith(expect.anything(), expect.stringContaining("\\\\"));
    });

    it("limits results to 50 maximum", async () => {
      const chain = createChain([]);
      selectQueue.push(chain);

      await handler()(makeRequest({ query: { q: "test", limit: "999" } }), makeReply());

      expect(chain.limit).toHaveBeenCalledWith(50);
    });

    it("defaults limit to 10", async () => {
      const chain = createChain([]);
      selectQueue.push(chain);

      await handler()(makeRequest({ query: { q: "test" } }), makeReply());

      expect(chain.limit).toHaveBeenCalledWith(10);
    });

    it("clamps limit minimum to 1", async () => {
      const chain = createChain([]);
      selectQueue.push(chain);

      await handler()(makeRequest({ query: { q: "test", limit: "-5" } }), makeReply());

      expect(chain.limit).toHaveBeenCalledWith(1);
    });

    it("returns empty array on db error", async () => {
      mockDb.select.mockImplementationOnce(() => { throw new Error("db down"); });

      const result = await handler()(makeRequest({ query: { q: "test" } }), makeReply());

      expect(result).toEqual([]);
    });

    it("returns search results on success", async () => {
      const mockResults = [
        { id: 1, conversationId: "c1", question: "Hello world", verdict: "Good", createdAt: new Date() },
      ];
      selectQueue.push(createChain(mockResults));

      const result = await handler()(makeRequest({ query: { q: "hello" } }), makeReply());

      expect(result).toEqual(mockResults);
    });
  });

  // ── GET / ───────────────────────────────────────────────────────────────

  describe("GET /", () => {
    const handler = () => routes["GET /"].handler;

    it("registers with auth preHandler", () => {
      expect(routes["GET /"].opts).toBeDefined();
    });

    it("returns paginated conversations with defaults (page 1, limit 20)", async () => {
      const mockList = [{ id: "c1", title: "Test" }];
      vi.mocked(getConversationList).mockResolvedValueOnce(mockList as any);
      // count query: db.select().from().where()
      selectQueue.push(createChain([{ value: 1 }]));

      const result = await handler()(makeRequest({ query: {} }), makeReply());

      expect(getConversationList).toHaveBeenCalledWith(1, 20, 0);
      expect(result.data).toEqual(mockList);
      expect(result.pagination).toEqual({ page: 1, limit: 20, total: 1, totalPages: 1 });
    });

    it("handles custom page and limit", async () => {
      vi.mocked(getConversationList).mockResolvedValueOnce([] as any);
      selectQueue.push(createChain([{ value: 50 }]));

      const result = await handler()(makeRequest({ query: { page: "3", limit: "10" } }), makeReply());

      expect(getConversationList).toHaveBeenCalledWith(1, 10, 20);
      expect(result.pagination.page).toBe(3);
      expect(result.pagination.limit).toBe(10);
      expect(result.pagination.totalPages).toBe(5);
    });

    it("clamps limit to max 100", async () => {
      vi.mocked(getConversationList).mockResolvedValueOnce([] as any);
      selectQueue.push(createChain([{ value: 0 }]));

      await handler()(makeRequest({ query: { limit: "500" } }), makeReply());

      expect(getConversationList).toHaveBeenCalledWith(1, 100, 0);
    });

    it("clamps page minimum to 1", async () => {
      vi.mocked(getConversationList).mockResolvedValueOnce([] as any);
      selectQueue.push(createChain([{ value: 0 }]));

      await handler()(makeRequest({ query: { page: "-1" } }), makeReply());

      expect(getConversationList).toHaveBeenCalledWith(1, 20, 0);
    });

    it("returns 0 total when count row has no value", async () => {
      vi.mocked(getConversationList).mockResolvedValueOnce([] as any);
      selectQueue.push(createChain([{}]));

      const result = await handler()(makeRequest({ query: {} }), makeReply());

      expect(result.pagination.total).toBe(0);
    });
  });

  // ── GET /:id ────────────────────────────────────────────────────────────

  describe("GET /:id", () => {
    const handler = () => routes["GET /:id"].handler;

    it("throws 404 when conversation not found", async () => {
      selectQueue.push(createChain([])); // conversation lookup returns nothing

      await expect(
        handler()(makeRequest({ params: { id: "no-exist" } }), makeReply())
      ).rejects.toThrow("Conversation not found");
    });

    it("returns conversation with chats and pagination", async () => {
      const conv = { id: "c1", title: "Test", userId: 1 };
      const chatRows = [{ id: 1, question: "Q1", verdict: "A1" }];

      // 1st select: conversation lookup
      selectQueue.push(createChain([conv]));
      // 2nd select: chat rows (Promise.all first)
      selectQueue.push(createChain(chatRows));
      // 3rd select: count (Promise.all second)
      selectQueue.push(createChain([{ value: 1 }]));

      const result = await handler()(
        makeRequest({ params: { id: "c1" }, query: {} }),
        makeReply()
      );

      expect(result.id).toBe("c1");
      expect(result.Chat).toEqual(chatRows);
      expect(result.pagination).toEqual({ page: 1, limit: 50, total: 1, totalPages: 1 });
    });

    it("uses custom pagination for chats (default limit 50)", async () => {
      const conv = { id: "c1", title: "Test" };

      selectQueue.push(createChain([conv]));
      selectQueue.push(createChain([]));
      selectQueue.push(createChain([{ value: 200 }]));

      const result = await handler()(
        makeRequest({ params: { id: "c1" }, query: { page: "2", limit: "25" } }),
        makeReply()
      );

      expect(result.pagination.page).toBe(2);
      expect(result.pagination.limit).toBe(25);
      expect(result.pagination.totalPages).toBe(8);
    });
  });

  // ── PATCH /:id ──────────────────────────────────────────────────────────

  describe("PATCH /:id", () => {
    const handler = () => routes["PATCH /:id"].handler;

    it("registers with auth and validation preHandlers", () => {
      const opts = routes["PATCH /:id"].opts;
      expect(opts).toBeDefined();
      expect(Array.isArray(opts.preHandler)).toBe(true);
    });

    it("returns success with updated title", async () => {
      vi.mocked(updateConversationTitle).mockResolvedValueOnce(true as any);

      const result = await handler()(
        makeRequest({ params: { id: "c1" }, body: { title: "New Title" } }),
        makeReply()
      );

      expect(updateConversationTitle).toHaveBeenCalledWith("c1", 1, "New Title");
      expect(result).toEqual({ success: true, title: "New Title" });
    });

    it("throws 404 when conversation not found", async () => {
      vi.mocked(updateConversationTitle).mockResolvedValueOnce(null as any);

      await expect(
        handler()(makeRequest({ params: { id: "nope" }, body: { title: "T" } }), makeReply())
      ).rejects.toThrow("Conversation not found");
    });
  });

  // ── DELETE /:id ─────────────────────────────────────────────────────────

  describe("DELETE /:id", () => {
    const handler = () => routes["DELETE /:id"].handler;

    it("returns success on deletion", async () => {
      vi.mocked(deleteConversation).mockResolvedValueOnce(true as any);

      const result = await handler()(
        makeRequest({ params: { id: "c1" } }),
        makeReply()
      );

      expect(deleteConversation).toHaveBeenCalledWith("c1", 1);
      expect(result).toEqual({ success: true });
    });

    it("throws 404 when conversation not found", async () => {
      vi.mocked(deleteConversation).mockResolvedValueOnce(false as any);

      await expect(
        handler()(makeRequest({ params: { id: "c1" } }), makeReply())
      ).rejects.toThrow("Conversation not found");
    });
  });

  // ── POST /:id/fork ─────────────────────────────────────────────────────

  describe("POST /:id/fork", () => {
    const handler = () => routes["POST /:id/fork"].handler;

    it("registers with auth and validation preHandlers", () => {
      const opts = routes["POST /:id/fork"].opts;
      expect(opts).toBeDefined();
      expect(Array.isArray(opts.preHandler)).toBe(true);
    });

    it("throws 404 when source conversation not found", async () => {
      selectQueue.push(createChain([]));

      await expect(
        handler()(makeRequest({ params: { id: "c1" }, body: { toChatId: 5 } }), makeReply())
      ).rejects.toThrow("Source conversation not found");
    });

    it("throws 400 when no messages to fork", async () => {
      const source = { id: "c1", title: "Original", userId: 1 };
      selectQueue.push(createChain([source]));
      selectQueue.push(createChain([])); // no chats to fork

      await expect(
        handler()(makeRequest({ params: { id: "c1" }, body: { toChatId: 5 } }), makeReply())
      ).rejects.toThrow("No messages to fork");
    });

    it("forks conversation with messages successfully", async () => {
      const source = { id: "c1", title: "Original", userId: 1 };
      const chatsToFork = [
        { id: 1, question: "Q1", verdict: "A1", opinions: [], conversationId: "c1", createdAt: new Date() },
        { id: 2, question: "Q2", verdict: "A2", opinions: [], conversationId: "c1", createdAt: new Date() },
      ];
      const fork = { id: "fork-1", title: "Fork of: Original", userId: 1 };

      // source lookup
      selectQueue.push(createChain([source]));
      // chatsToFork
      selectQueue.push(createChain(chatsToFork));
      // insert conversation (returning resolves to [fork])
      insertQueue.push(createChain([fork]));
      // insert chats
      insertQueue.push(createChain(undefined));

      const result = await handler()(
        makeRequest({ params: { id: "c1" }, body: { toChatId: 2 } }),
        makeReply()
      );

      expect(result).toEqual({ success: true, forkId: "fork-1", count: 2 });
    });
  });

  // ── GET /shared/:id ─────────────────────────────────────────────────────

  describe("GET /shared/:id", () => {
    const handler = () => routes["GET /shared/:id"].handler;

    it("does NOT register with auth preHandler", () => {
      expect(routes["GET /shared/:id"].opts).toBeUndefined();
    });

    it("throws 404 when public conversation not found", async () => {
      selectQueue.push(createChain([]));

      await expect(
        handler()({ params: { id: "c1" } }, makeReply())
      ).rejects.toThrow("Public conversation not found");
    });

    it("returns public conversation with chats", async () => {
      const conv = { id: "c1", title: "Shared", isPublic: true };
      const chatRows = [{ id: 1, question: "Q", verdict: "V" }];

      selectQueue.push(createChain([conv]));
      selectQueue.push(createChain(chatRows));

      const result = await handler()({ params: { id: "c1" } }, makeReply());

      expect(result.id).toBe("c1");
      expect(result.isPublic).toBe(true);
      expect(result.Chat).toEqual(chatRows);
    });
  });

  // ── PATCH /:id/share ────────────────────────────────────────────────────

  describe("PATCH /:id/share", () => {
    const handler = () => routes["PATCH /:id/share"].handler;

    it("registers with auth preHandler", () => {
      expect(routes["PATCH /:id/share"].opts).toBeDefined();
    });

    it("throws 400 when isPublic is not a boolean", async () => {
      await expect(
        handler()(makeRequest({ params: { id: "c1" }, body: { isPublic: "yes" } }), makeReply())
      ).rejects.toThrow("isPublic must be a boolean");
    });

    it("throws 400 when isPublic is a number", async () => {
      await expect(
        handler()(makeRequest({ params: { id: "c1" }, body: { isPublic: 1 } }), makeReply())
      ).rejects.toThrow("isPublic must be a boolean");
    });

    it("throws 404 when conversation not found", async () => {
      updateQueue.push(createChain([]));

      await expect(
        handler()(makeRequest({ params: { id: "c1" }, body: { isPublic: true } }), makeReply())
      ).rejects.toThrow("Conversation not found");
    });

    it("enables sharing successfully", async () => {
      updateQueue.push(createChain([{ id: "c1", isPublic: true }]));

      const result = await handler()(
        makeRequest({ params: { id: "c1" }, body: { isPublic: true } }),
        makeReply()
      );

      expect(result).toEqual({ success: true, isPublic: true });
    });

    it("disables sharing successfully", async () => {
      updateQueue.push(createChain([{ id: "c1", isPublic: false }]));

      const result = await handler()(
        makeRequest({ params: { id: "c1" }, body: { isPublic: false } }),
        makeReply()
      );

      expect(result).toEqual({ success: true, isPublic: false });
    });
  });

  // ── Route registration ──────────────────────────────────────────────────

  describe("Route registration", () => {
    it("registers all expected routes", () => {
      expect(mockFastify.get).toHaveBeenCalled();
      expect(mockFastify.post).toHaveBeenCalled();
      expect(mockFastify.patch).toHaveBeenCalled();
      expect(mockFastify.delete).toHaveBeenCalled();

      expect(routes["GET /search"]).toBeDefined();
      expect(routes["GET /"]).toBeDefined();
      expect(routes["GET /:id"]).toBeDefined();
      expect(routes["PATCH /:id"]).toBeDefined();
      expect(routes["DELETE /:id"]).toBeDefined();
      expect(routes["POST /:id/fork"]).toBeDefined();
      expect(routes["GET /shared/:id"]).toBeDefined();
      expect(routes["PATCH /:id/share"]).toBeDefined();
    });
  });
});
