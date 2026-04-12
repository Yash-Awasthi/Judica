import { describe, it, expect, vi, beforeEach } from "vitest";

// ── DB chain factory ────────────────────────────────────────────────────────

function createChain(resolvedValue: any = []) {
  const chain: any = {};
  const methods = ["from", "where", "orderBy", "offset", "limit", "set", "values", "returning"];
  for (const m of methods) {
    chain[m] = vi.fn(() => chain);
  }
  chain.then = (resolve: any, reject?: any) => Promise.resolve(resolvedValue).then(resolve, reject);
  return chain;
}

let selectQueue: any[];

const mockDb: any = {
  select: vi.fn((..._args: any[]) => {
    return selectQueue.shift() || createChain([]);
  }),
};

vi.mock("../../src/lib/drizzle.js", () => ({ db: mockDb }));

vi.mock("../../src/db/schema/conversations.js", () => ({
  conversations: {
    id: "id",
    userId: "userId",
    title: "title",
    createdAt: "createdAt",
    updatedAt: "updatedAt",
    isPublic: "isPublic",
  },
  chats: {
    id: "id",
    conversationId: "conversationId",
    userId: "userId",
    question: "question",
    verdict: "verdict",
    opinions: "opinions",
    createdAt: "createdAt",
    durationMs: "durationMs",
    tokensUsed: "tokensUsed",
  },
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((...a: any[]) => ["eq", ...a]),
  and: vi.fn((...a: any[]) => ["and", ...a]),
  asc: vi.fn((col: any) => ["asc", col]),
  desc: vi.fn((col: any) => ["desc", col]),
  inArray: vi.fn((...a: any[]) => ["inArray", ...a]),
}));

vi.mock("../../src/middleware/fastifyAuth.js", () => ({
  fastifyRequireAuth: vi.fn(),
}));

vi.mock("../../src/middleware/errorHandler.js", () => ({
  AppError: class AppError extends Error {
    statusCode: number;
    code: string;
    constructor(statusCode: number, message: string, code?: string) {
      super(message);
      this.statusCode = statusCode;
      this.code = code || "INTERNAL_ERROR";
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
};

// ── Request / Reply helpers ─────────────────────────────────────────────────

function makeRequest(overrides: Record<string, any> = {}): any {
  return { userId: 1, query: {}, params: {}, body: {}, ...overrides };
}

function makeReply(): any {
  return {
    code: vi.fn().mockReturnThis(),
    send: vi.fn().mockReturnThis(),
    header: vi.fn().mockReturnThis(),
    type: vi.fn().mockReturnThis(),
  };
}

// ── Fixtures ────────────────────────────────────────────────────────────────

const NOW = new Date("2025-01-15T12:00:00Z");

const fakeConversation = {
  id: "conv-1",
  userId: 1,
  title: "Test Conversation",
  createdAt: NOW,
  updatedAt: NOW,
  isPublic: false,
  sessionSummary: null,
};

const fakeChat1 = {
  id: 1,
  userId: 1,
  conversationId: "conv-1",
  question: "What is 2+2?",
  verdict: "The answer is 4.",
  opinions: { gpt4: "It is 4", claude: "Definitely 4" },
  createdAt: NOW,
  cacheHit: false,
  durationMs: 500,
  tokensUsed: 100,
  embedding: null,
};

const fakeChat2 = {
  id: 2,
  userId: 1,
  conversationId: "conv-1",
  question: "What is 3+3?",
  verdict: "The answer is 6.",
  opinions: { gpt4: "Six", claude: "6" },
  createdAt: new Date("2025-01-15T13:00:00Z"),
  cacheHit: false,
  durationMs: 300,
  tokensUsed: 80,
  embedding: null,
};

// ── Tests ───────────────────────────────────────────────────────────────────

describe("Export Routes", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    selectQueue = [];

    Object.keys(routes).forEach((k) => delete routes[k]);
    const mod = await import("../../src/routes/export.js");
    await (mod.default as any)(mockFastify as any);
  });

  // ── GET /conversation/:id ───────────────────────────────────────────────

  describe("GET /conversation/:id", () => {
    const handler = () => routes["GET /conversation/:id"].handler;

    it("registers route with preHandler for auth", () => {
      expect(routes["GET /conversation/:id"]).toBeDefined();
      expect(routes["GET /conversation/:id"].opts).toBeDefined();
      expect(routes["GET /conversation/:id"].opts.preHandler).toBeDefined();
    });

    it("returns 404 when conversation not found", async () => {
      selectQueue = [createChain([])]; // conversation query returns empty
      const reply = makeReply();
      const result = await handler()(makeRequest({ params: { id: "nonexistent" } }), reply);

      expect(reply.code).toHaveBeenCalledWith(404);
      expect(reply.send).toHaveBeenCalledWith({ error: "Conversation not found" });
      expect(result).toBeUndefined();
    });

    it("exports conversation as JSON on success", async () => {
      selectQueue = [
        createChain([fakeConversation]), // conversation query
        createChain([fakeChat1, fakeChat2]), // chats query
      ];
      const reply = makeReply();
      const result = await handler()(makeRequest({ params: { id: "conv-1" } }), reply);

      expect(reply.header).toHaveBeenCalledWith(
        "Content-Disposition",
        'attachment; filename="conversation-conv-1.json"',
      );
      expect(reply.type).toHaveBeenCalledWith("application/json");

      expect(result).toBeDefined();
      expect(result.exportedAt).toBeDefined();
      expect(result.conversation.id).toBe("conv-1");
      expect(result.conversation.title).toBe("Test Conversation");
      expect(result.conversation.chats).toHaveLength(2);

      // Verify mapChat shape
      const exported = result.conversation.chats[0];
      expect(exported.id).toBe(1);
      expect(exported.question).toBe("What is 2+2?");
      expect(exported.verdict).toBe("The answer is 4.");
      expect(exported.opinions).toEqual({ gpt4: "It is 4", claude: "Definitely 4" });
      expect(exported.durationMs).toBe(500);
      expect(exported.tokensUsed).toBe(100);
      expect(exported.createdAt).toBe(NOW);
    });

    it("exports conversation with no chats", async () => {
      selectQueue = [
        createChain([fakeConversation]),
        createChain([]), // no chats
      ];
      const reply = makeReply();
      const result = await handler()(makeRequest({ params: { id: "conv-1" } }), reply);

      expect(result.conversation.chats).toHaveLength(0);
    });

    it("throws AppError on db failure", async () => {
      const failChain: any = {};
      const methods = ["from", "where", "orderBy", "offset", "limit"];
      for (const m of methods) {
        failChain[m] = vi.fn(() => failChain);
      }
      failChain.then = (_resolve: any, reject?: any) => {
        return Promise.reject(new Error("DB down")).then(_resolve, reject);
      };
      selectQueue = [failChain];

      await expect(
        handler()(makeRequest({ params: { id: "conv-1" } }), makeReply()),
      ).rejects.toThrow("Failed to export conversation");
    });
  });

  // ── GET /all ────────────────────────────────────────────────────────────

  describe("GET /all", () => {
    const handler = () => routes["GET /all"].handler;

    it("registers route with preHandler for auth", () => {
      expect(routes["GET /all"]).toBeDefined();
      expect(routes["GET /all"].opts).toBeDefined();
      expect(routes["GET /all"].opts.preHandler).toBeDefined();
    });

    it("exports all conversations with chats", async () => {
      const fakeConv2 = {
        ...fakeConversation,
        id: "conv-2",
        title: "Second Conversation",
      };
      selectQueue = [
        createChain([fakeConversation, fakeConv2]), // conversations query
        createChain([fakeChat1, fakeChat2, { ...fakeChat1, id: 3, conversationId: "conv-2" }]), // all chats
      ];
      const reply = makeReply();
      const result = await handler()(makeRequest(), reply);

      expect(reply.header).toHaveBeenCalledWith(
        "Content-Disposition",
        'attachment; filename="all-conversations.json"',
      );
      expect(reply.type).toHaveBeenCalledWith("application/json");

      expect(result.exportedAt).toBeDefined();
      expect(result.totalConversations).toBe(2);
      expect(result.totalChats).toBe(3);
      expect(result.conversations).toHaveLength(2);
      expect(result.conversations[0].id).toBe("conv-1");
      expect(result.conversations[0].chats).toHaveLength(2);
      expect(result.conversations[1].id).toBe("conv-2");
      expect(result.conversations[1].chats).toHaveLength(1);
    });

    it("returns empty export when user has no conversations", async () => {
      selectQueue = [createChain([])]; // no conversations
      const reply = makeReply();
      const result = await handler()(makeRequest(), reply);

      expect(result.totalConversations).toBe(0);
      expect(result.totalChats).toBe(0);
      expect(result.conversations).toHaveLength(0);
    });

    it("handles conversations with no chats", async () => {
      selectQueue = [
        createChain([fakeConversation]), // one conversation
        createChain([]), // no chats found
      ];
      const reply = makeReply();
      const result = await handler()(makeRequest(), reply);

      expect(result.totalConversations).toBe(1);
      expect(result.totalChats).toBe(0);
      expect(result.conversations[0].chats).toHaveLength(0);
    });

    it("throws AppError on db failure", async () => {
      const failChain: any = {};
      const methods = ["from", "where", "orderBy", "offset", "limit"];
      for (const m of methods) {
        failChain[m] = vi.fn(() => failChain);
      }
      failChain.then = (_resolve: any, reject?: any) => {
        return Promise.reject(new Error("DB down")).then(_resolve, reject);
      };
      selectQueue = [failChain];

      await expect(
        handler()(makeRequest(), makeReply()),
      ).rejects.toThrow("Failed to export conversations");
    });
  });

  // ── GET /conversation/:id/markdown ──────────────────────────────────────

  describe("GET /conversation/:id/markdown", () => {
    const handler = () => routes["GET /conversation/:id/markdown"].handler;

    it("registers route with preHandler for auth", () => {
      expect(routes["GET /conversation/:id/markdown"]).toBeDefined();
      expect(routes["GET /conversation/:id/markdown"].opts).toBeDefined();
      expect(routes["GET /conversation/:id/markdown"].opts.preHandler).toBeDefined();
    });

    it("returns 404 when conversation not found", async () => {
      selectQueue = [createChain([])];
      const reply = makeReply();
      const result = await handler()(makeRequest({ params: { id: "missing" } }), reply);

      expect(reply.code).toHaveBeenCalledWith(404);
      expect(reply.send).toHaveBeenCalledWith({ error: "Conversation not found" });
      expect(result).toBeUndefined();
    });

    it("exports conversation as markdown on success", async () => {
      selectQueue = [
        createChain([fakeConversation]),
        createChain([fakeChat1, fakeChat2]),
      ];
      const reply = makeReply();
      const result = await handler()(makeRequest({ params: { id: "conv-1" } }), reply);

      expect(reply.type).toHaveBeenCalledWith("text/markdown");
      expect(reply.header).toHaveBeenCalledWith(
        "Content-Disposition",
        'attachment; filename="conversation-conv-1.md"',
      );

      // Verify markdown structure
      expect(result).toContain("# Test Conversation");
      expect(result).toContain("**Exported:**");
      expect(result).toContain("---");

      // Verify chat content in markdown
      expect(result).toContain("## Question\n\nWhat is 2+2?");
      expect(result).toContain("## Verdict\n\nThe answer is 4.");
      expect(result).toContain("## Question\n\nWhat is 3+3?");
      expect(result).toContain("## Verdict\n\nThe answer is 6.");
    });

    it("includes council opinions in markdown", async () => {
      selectQueue = [
        createChain([fakeConversation]),
        createChain([fakeChat1]),
      ];
      const reply = makeReply();
      const result = await handler()(makeRequest({ params: { id: "conv-1" } }), reply);

      expect(result).toContain("## Council Opinions");
      expect(result).toContain("### gpt4\n\nIt is 4");
      expect(result).toContain("### claude\n\nDefinitely 4");
    });

    it("skips opinions section when opinions is not an object", async () => {
      const chatNoOpinions = { ...fakeChat1, opinions: null };
      selectQueue = [
        createChain([fakeConversation]),
        createChain([chatNoOpinions]),
      ];
      const reply = makeReply();
      const result = await handler()(makeRequest({ params: { id: "conv-1" } }), reply);

      expect(result).not.toContain("## Council Opinions");
    });

    it("handles conversation with no chats", async () => {
      selectQueue = [
        createChain([fakeConversation]),
        createChain([]),
      ];
      const reply = makeReply();
      const result = await handler()(makeRequest({ params: { id: "conv-1" } }), reply);

      expect(result).toContain("# Test Conversation");
      expect(result).not.toContain("## Question");
    });

    it("throws AppError on db failure", async () => {
      const failChain: any = {};
      const methods = ["from", "where", "orderBy", "offset", "limit"];
      for (const m of methods) {
        failChain[m] = vi.fn(() => failChain);
      }
      failChain.then = (_resolve: any, reject?: any) => {
        return Promise.reject(new Error("DB down")).then(_resolve, reject);
      };
      selectQueue = [failChain];

      await expect(
        handler()(makeRequest({ params: { id: "conv-1" } }), makeReply()),
      ).rejects.toThrow("Failed to export conversation");
    });
  });

  // ── Route registration ──────────────────────────────────────────────────

  describe("Route registration", () => {
    it("registers exactly three GET routes", () => {
      const keys = Object.keys(routes);
      expect(keys).toHaveLength(3);
      expect(keys).toContain("GET /conversation/:id");
      expect(keys).toContain("GET /all");
      expect(keys).toContain("GET /conversation/:id/markdown");
    });
  });
});
