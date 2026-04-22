import { describe, it, expect, vi, beforeEach } from "vitest";

// ---- mocks ----

const { mockDb } = vi.hoisted(() => {
  const mockDb: any = {};
  return { mockDb };
});

function chainable(overrides: Record<string, any> = {}): any {
  const chain: any = {};
  const methods = [
    "select",
    "from",
    "where",
    "limit",
    "orderBy",
    "offset",
    "update",
    "set",
    "insert",
    "values",
    "returning",
    "delete",
    "onConflictDoUpdate",
  ];
  for (const m of methods) {
    chain[m] = overrides[m] ?? vi.fn(() => chain);
  }
  return chain;
}

vi.mock("../../src/lib/drizzle.js", () => ({
  db: mockDb,
}));

vi.mock("../../src/db/schema/conversations.js", () => ({
  conversations: {
    id: "conversations.id",
    userId: "conversations.userId",
  },
  chats: {
    conversationId: "chats.conversationId",
    createdAt: "chats.createdAt",
  },
}));

vi.mock("../../src/db/schema/social.js", () => ({
  sharedConversations: {
    id: "sharedConversations.id",
    conversationId: "sharedConversations.conversationId",
    ownerId: "sharedConversations.ownerId",
    shareToken: "sharedConversations.shareToken",
    access: "sharedConversations.access",
    expiresAt: "sharedConversations.expiresAt",
  },
  sharedWorkflows: {
    id: "sharedWorkflows.id",
    workflowId: "sharedWorkflows.workflowId",
    ownerId: "sharedWorkflows.ownerId",
    shareToken: "sharedWorkflows.shareToken",
    expiresAt: "sharedWorkflows.expiresAt",
  },
  sharedPrompts: {
    id: "sharedPrompts.id",
    promptId: "sharedPrompts.promptId",
    ownerId: "sharedPrompts.ownerId",
    shareToken: "sharedPrompts.shareToken",
    expiresAt: "sharedPrompts.expiresAt",
  },
}));

vi.mock("../../src/db/schema/workflows.js", () => ({
  workflows: {
    id: "workflows.id",
    userId: "workflows.userId",
  },
}));

vi.mock("../../src/db/schema/prompts.js", () => ({
  prompts: {
    id: "prompts.id",
    userId: "prompts.userId",
  },
  promptVersions: {
    promptId: "promptVersions.promptId",
    versionNum: "promptVersions.versionNum",
  },
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((...args: any[]) => args),
  and: vi.fn((...args: any[]) => args),
  asc: vi.fn((col: any) => col),
  desc: vi.fn((col: any) => col),
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

vi.mock("node:crypto", () => ({
  randomUUID: vi.fn(() => "mock-uuid"),
}));

vi.mock("crypto", () => ({
  randomUUID: vi.fn(() => "mock-uuid"),
}));

vi.mock("@fastify/rate-limit", () => ({
  default: vi.fn(),
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
    delete: register("DELETE"),
    register: vi.fn().mockResolvedValue(undefined),
  };
}

function createRequest(
  overrides: Partial<{
    userId: number;
    body: any;
    params: any;
    query: any;
  }> = {},
): any {
  return {
    userId: overrides.userId ?? 1,
    body: overrides.body ?? {},
    params: overrides.params ?? {},
    query: overrides.query ?? {},
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

// ---- register the plugin once ----

import sharePlugin from "../../src/routes/share.js";
import { AppError } from "../../src/middleware/errorHandler.js";

let fastifyInstance: any;

beforeEach(async () => {
  Object.keys(registeredRoutes).forEach((k) => delete registeredRoutes[k]);
  vi.clearAllMocks();
  fastifyInstance = createFastifyInstance();
  await sharePlugin(fastifyInstance, {});
});

// ========== Tests ==========

describe("share routes", () => {
  // ---- POST /conversations/:id ----
  describe("POST /conversations/:id", () => {
    const route = () => registeredRoutes["POST /conversations/:id"];

    it("registers with preHandler auth", () => {
      expect(route().preHandler).toBeDefined();
    });

    it("returns shareToken and url on success", async () => {
      const convo = { id: "conv-1", userId: 1 };
      const shared = { shareToken: "tok-abc", id: "shared-1" };

      const selectChain = chainable({ limit: vi.fn(() => [convo]) });
      mockDb.select = vi.fn(() => selectChain);

      const insertChain = chainable({ returning: vi.fn(() => [shared]) });
      mockDb.insert = vi.fn(() => insertChain);

      const req = createRequest({
        params: { id: "conv-1" },
        body: { access: "write", expiresIn: "7d" },
      });
      const reply = createReply();

      const result = await route().handler(req, reply);
      expect(result).toEqual({ shareToken: "tok-abc", url: "/share/tok-abc" });
      expect(mockDb.insert).toHaveBeenCalled();
    });

    it("defaults access to read when not provided", async () => {
      const convo = { id: "conv-1", userId: 1 };
      const shared = { shareToken: "tok-abc" };

      const selectChain = chainable({ limit: vi.fn(() => [convo]) });
      mockDb.select = vi.fn(() => selectChain);

      const valuesChain = chainable({ returning: vi.fn(() => [shared]) });
      const insertChain = chainable({ values: vi.fn(() => valuesChain) });
      mockDb.insert = vi.fn(() => insertChain);

      const req = createRequest({ params: { id: "conv-1" }, body: {} });
      const reply = createReply();

      const result = await route().handler(req, reply);
      expect(result).toEqual({ shareToken: "tok-abc", url: "/share/tok-abc" });
    });

    it("throws 404 when conversation not found", async () => {
      const selectChain = chainable({ limit: vi.fn(() => []) });
      mockDb.select = vi.fn(() => selectChain);

      const req = createRequest({ params: { id: "nonexistent" } });
      const reply = createReply();

      await expect(route().handler(req, reply)).rejects.toThrow();
      try {
        await route().handler(req, reply);
      } catch (err: any) {
        expect(err).toBeInstanceOf(AppError);
        expect(err.statusCode).toBe(404);
        expect(err.code).toBe("NOT_FOUND");
      }
    });

    it("passes expiresIn=24h correctly", async () => {
      const convo = { id: "conv-1", userId: 1 };
      const shared = { shareToken: "tok-24h" };

      const selectChain = chainable({ limit: vi.fn(() => [convo]) });
      mockDb.select = vi.fn(() => selectChain);

      const insertChain = chainable({ returning: vi.fn(() => [shared]) });
      mockDb.insert = vi.fn(() => insertChain);

      const req = createRequest({ params: { id: "conv-1" }, body: { expiresIn: "24h" } });
      const reply = createReply();

      const result = await route().handler(req, reply);
      expect(result.shareToken).toBe("tok-24h");
    });

    it("passes expiresIn=30d correctly", async () => {
      const convo = { id: "conv-1", userId: 1 };
      const shared = { shareToken: "tok-30d" };

      const selectChain = chainable({ limit: vi.fn(() => [convo]) });
      mockDb.select = vi.fn(() => selectChain);

      const insertChain = chainable({ returning: vi.fn(() => [shared]) });
      mockDb.insert = vi.fn(() => insertChain);

      const req = createRequest({ params: { id: "conv-1" }, body: { expiresIn: "30d" } });
      const reply = createReply();

      const result = await route().handler(req, reply);
      expect(result.shareToken).toBe("tok-30d");
    });

    it("throws 400 for unknown expiresIn value", async () => {
      const convo = { id: "conv-1", userId: 1 };

      const selectChain = chainable({ limit: vi.fn(() => [convo]) });
      mockDb.select = vi.fn(() => selectChain);

      const insertChain = chainable({ returning: vi.fn(() => [{ shareToken: "tok-none" }]) });
      mockDb.insert = vi.fn(() => insertChain);

      const req = createRequest({ params: { id: "conv-1" }, body: { expiresIn: "bogus" } });
      const reply = createReply();

      await expect(route().handler(req, reply)).rejects.toThrow("Invalid expiresIn value");
    });
  });

  // ---- DELETE /conversations/:id ----
  describe("DELETE /conversations/:id", () => {
    const route = () => registeredRoutes["DELETE /conversations/:id"];

    it("registers with preHandler auth", () => {
      expect(route().preHandler).toBeDefined();
    });

    it("returns success true", async () => {
      const deleteChain = chainable();
      mockDb.delete = vi.fn(() => deleteChain);

      const req = createRequest({ params: { id: "conv-1" } });
      const reply = createReply();

      const result = await route().handler(req, reply);
      expect(result).toEqual({ success: true });
      expect(mockDb.delete).toHaveBeenCalled();
    });
  });

  // ---- GET /view/:token ----
  describe("GET /view/:token", () => {
    const route = () => registeredRoutes["GET /view/:token"];

    it("registers without preHandler (public)", () => {
      expect(route().preHandler).toBeUndefined();
    });

    it("returns conversation and chats on success", async () => {
      const shared = { conversationId: "conv-1", access: "read", expiresAt: null, shareToken: "tok" };
      const convo = { id: "conv-1", title: "My convo" };
      const chatList = [{ id: "c1" }, { id: "c2" }];

      let selectCallCount = 0;
      mockDb.select = vi.fn(() => {
        selectCallCount++;
        if (selectCallCount === 1) return chainable({ limit: vi.fn(() => [shared]) });
        if (selectCallCount === 2) return chainable({ limit: vi.fn(() => [convo]) });
        return chainable({ limit: vi.fn(() => chatList) });
      });

      const req = createRequest({ params: { token: "tok" } });
      const reply = createReply();

      const result = await route().handler(req, reply);
      expect(result).toEqual({ conversation: convo, chats: chatList, access: "read" });
    });

    it("throws 404 when share not found", async () => {
      const selectChain = chainable({ limit: vi.fn(() => []) });
      mockDb.select = vi.fn(() => selectChain);

      const req = createRequest({ params: { token: "bad-token" } });
      const reply = createReply();

      await expect(route().handler(req, reply)).rejects.toThrow();
      try {
        await route().handler(req, reply);
      } catch (err: any) {
        expect(err).toBeInstanceOf(AppError);
        expect(err.statusCode).toBe(404);
        expect(err.code).toBe("SHARE_NOT_FOUND");
      }
    });

    it("throws 410 when share link expired", async () => {
      const pastDate = new Date(Date.now() - 1000);
      const shared = { conversationId: "conv-1", access: "read", expiresAt: pastDate, shareToken: "tok" };

      const selectChain = chainable({ limit: vi.fn(() => [shared]) });
      mockDb.select = vi.fn(() => selectChain);

      const req = createRequest({ params: { token: "tok" } });
      const reply = createReply();

      await expect(route().handler(req, reply)).rejects.toThrow();
      try {
        await route().handler(req, reply);
      } catch (err: any) {
        expect(err).toBeInstanceOf(AppError);
        expect(err.statusCode).toBe(410);
        expect(err.code).toBe("SHARE_EXPIRED");
      }
    });

    it("does not throw when expiresAt is in the future", async () => {
      const futureDate = new Date(Date.now() + 100_000);
      const shared = { conversationId: "conv-1", access: "write", expiresAt: futureDate, shareToken: "tok" };
      const convo = { id: "conv-1" };
      const chatList = [{ id: "c1" }];

      let selectCallCount = 0;
      mockDb.select = vi.fn(() => {
        selectCallCount++;
        if (selectCallCount === 1) return chainable({ limit: vi.fn(() => [shared]) });
        if (selectCallCount === 2) return chainable({ limit: vi.fn(() => [convo]) });
        return chainable({ limit: vi.fn(() => chatList) });
      });

      const req = createRequest({ params: { token: "tok" } });
      const reply = createReply();

      const result = await route().handler(req, reply);
      expect(result.access).toBe("write");
    });
  });

  // ---- POST /workflows/:id ----
  describe("POST /workflows/:id", () => {
    const route = () => registeredRoutes["POST /workflows/:id"];

    it("registers with preHandler auth", () => {
      expect(route().preHandler).toBeDefined();
    });

    it("returns shareToken on success", async () => {
      const wf = { id: "wf-1", userId: 1 };
      const shared = { shareToken: "wf-tok" };

      const selectChain = chainable({ limit: vi.fn(() => [wf]) });
      mockDb.select = vi.fn(() => selectChain);

      const insertChain = chainable({ returning: vi.fn(() => [shared]) });
      mockDb.insert = vi.fn(() => insertChain);

      const req = createRequest({ params: { id: "wf-1" }, body: { expiresIn: "7d" } });
      const reply = createReply();

      const result = await route().handler(req, reply);
      expect(result).toEqual({ shareToken: "wf-tok" });
    });

    it("throws 404 when workflow not found", async () => {
      const selectChain = chainable({ limit: vi.fn(() => []) });
      mockDb.select = vi.fn(() => selectChain);

      const req = createRequest({ params: { id: "nonexistent" } });
      const reply = createReply();

      await expect(route().handler(req, reply)).rejects.toThrow();
      try {
        await route().handler(req, reply);
      } catch (err: any) {
        expect(err).toBeInstanceOf(AppError);
        expect(err.statusCode).toBe(404);
        expect(err.code).toBe("NOT_FOUND");
      }
    });
  });

  // ---- GET /workflow/:token ----
  describe("GET /workflow/:token", () => {
    const route = () => registeredRoutes["GET /workflow/:token"];

    it("registers without preHandler (public)", () => {
      expect(route().preHandler).toBeUndefined();
    });

    it("returns workflow on success", async () => {
      const shared = { workflowId: "wf-1", expiresAt: null, shareToken: "wf-tok" };
      const wf = { id: "wf-1", name: "My workflow" };

      let selectCallCount = 0;
      mockDb.select = vi.fn(() => {
        selectCallCount++;
        if (selectCallCount === 1) return chainable({ limit: vi.fn(() => [shared]) });
        return chainable({ limit: vi.fn(() => [wf]) });
      });

      const req = createRequest({ params: { token: "wf-tok" } });
      const reply = createReply();

      const result = await route().handler(req, reply);
      expect(result).toEqual({ workflow: wf });
    });

    it("throws 404 when share not found", async () => {
      const selectChain = chainable({ limit: vi.fn(() => []) });
      mockDb.select = vi.fn(() => selectChain);

      const req = createRequest({ params: { token: "bad" } });
      const reply = createReply();

      await expect(route().handler(req, reply)).rejects.toThrow();
      try {
        await route().handler(req, reply);
      } catch (err: any) {
        expect(err).toBeInstanceOf(AppError);
        expect(err.statusCode).toBe(404);
        expect(err.code).toBe("SHARE_NOT_FOUND");
      }
    });

    it("throws 410 when share expired", async () => {
      const pastDate = new Date(Date.now() - 1000);
      const shared = { workflowId: "wf-1", expiresAt: pastDate, shareToken: "wf-tok" };

      const selectChain = chainable({ limit: vi.fn(() => [shared]) });
      mockDb.select = vi.fn(() => selectChain);

      const req = createRequest({ params: { token: "wf-tok" } });
      const reply = createReply();

      await expect(route().handler(req, reply)).rejects.toThrow();
      try {
        await route().handler(req, reply);
      } catch (err: any) {
        expect(err).toBeInstanceOf(AppError);
        expect(err.statusCode).toBe(410);
        expect(err.code).toBe("SHARE_EXPIRED");
      }
    });
  });

  // ---- POST /prompts/:id ----
  describe("POST /prompts/:id", () => {
    const route = () => registeredRoutes["POST /prompts/:id"];

    it("registers with preHandler auth", () => {
      expect(route().preHandler).toBeDefined();
    });

    it("returns shareToken on success", async () => {
      const prompt = { id: "p-1", userId: 1 };
      const shared = { shareToken: "p-tok" };

      const selectChain = chainable({ limit: vi.fn(() => [prompt]) });
      mockDb.select = vi.fn(() => selectChain);

      const insertChain = chainable({ returning: vi.fn(() => [shared]) });
      mockDb.insert = vi.fn(() => insertChain);

      const req = createRequest({ params: { id: "p-1" }, body: { expiresIn: "24h" } });
      const reply = createReply();

      const result = await route().handler(req, reply);
      expect(result).toEqual({ shareToken: "p-tok" });
    });

    it("throws 404 when prompt not found", async () => {
      const selectChain = chainable({ limit: vi.fn(() => []) });
      mockDb.select = vi.fn(() => selectChain);

      const req = createRequest({ params: { id: "nonexistent" } });
      const reply = createReply();

      await expect(route().handler(req, reply)).rejects.toThrow();
      try {
        await route().handler(req, reply);
      } catch (err: any) {
        expect(err).toBeInstanceOf(AppError);
        expect(err.statusCode).toBe(404);
        expect(err.code).toBe("NOT_FOUND");
      }
    });
  });

  // ---- GET /prompt/:token ----
  describe("GET /prompt/:token", () => {
    const route = () => registeredRoutes["GET /prompt/:token"];

    it("registers without preHandler (public)", () => {
      expect(route().preHandler).toBeUndefined();
    });

    it("returns prompt with versions on success", async () => {
      const shared = { promptId: "p-1", expiresAt: null, shareToken: "p-tok" };
      const prompt = { id: "p-1", name: "My prompt" };
      const versions = [{ versionNum: 2, content: "v2" }];

      let selectCallCount = 0;
      mockDb.select = vi.fn(() => {
        selectCallCount++;
        if (selectCallCount === 1) return chainable({ limit: vi.fn(() => [shared]) });
        if (selectCallCount === 2) return chainable({ limit: vi.fn(() => [prompt]) });
        return chainable({ limit: vi.fn(() => versions) });
      });

      const req = createRequest({ params: { token: "p-tok" } });
      const reply = createReply();

      const result = await route().handler(req, reply);
      expect(result).toEqual({ prompt: { ...prompt, versions } });
    });

    it("returns null prompt when prompt record not found", async () => {
      const shared = { promptId: "p-gone", expiresAt: null, shareToken: "p-tok" };

      let selectCallCount = 0;
      mockDb.select = vi.fn(() => {
        selectCallCount++;
        if (selectCallCount === 1) return chainable({ limit: vi.fn(() => [shared]) });
        if (selectCallCount === 2) return chainable({ limit: vi.fn(() => []) }); // prompt missing
        return chainable({ limit: vi.fn(() => []) });
      });

      const req = createRequest({ params: { token: "p-tok" } });
      const reply = createReply();

      const result = await route().handler(req, reply);
      expect(result).toEqual({ prompt: null });
    });

    it("throws 404 when share not found", async () => {
      const selectChain = chainable({ limit: vi.fn(() => []) });
      mockDb.select = vi.fn(() => selectChain);

      const req = createRequest({ params: { token: "bad" } });
      const reply = createReply();

      await expect(route().handler(req, reply)).rejects.toThrow();
      try {
        await route().handler(req, reply);
      } catch (err: any) {
        expect(err).toBeInstanceOf(AppError);
        expect(err.statusCode).toBe(404);
        expect(err.code).toBe("SHARE_NOT_FOUND");
      }
    });

    it("throws 410 when share expired", async () => {
      const pastDate = new Date(Date.now() - 1000);
      const shared = { promptId: "p-1", expiresAt: pastDate, shareToken: "p-tok" };

      const selectChain = chainable({ limit: vi.fn(() => [shared]) });
      mockDb.select = vi.fn(() => selectChain);

      const req = createRequest({ params: { token: "p-tok" } });
      const reply = createReply();

      await expect(route().handler(req, reply)).rejects.toThrow();
      try {
        await route().handler(req, reply);
      } catch (err: any) {
        expect(err).toBeInstanceOf(AppError);
        expect(err.statusCode).toBe(410);
        expect(err.code).toBe("SHARE_EXPIRED");
      }
    });
  });

  // ---- route registration completeness ----
  describe("route registration", () => {
    it("registers all 7 expected routes", () => {
      const expected = [
        "POST /conversations/:id",
        "DELETE /conversations/:id",
        "GET /view/:token",
        "POST /workflows/:id",
        "GET /workflow/:token",
        "POST /prompts/:id",
        "GET /prompt/:token",
      ];
      for (const key of expected) {
        expect(registeredRoutes[key]).toBeDefined();
      }
    });
  });
});
