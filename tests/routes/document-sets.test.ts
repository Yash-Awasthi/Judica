import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mocks ──────────────────────────────────────────────────────────────────

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
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const mockService = {
  createDocumentSet: vi.fn(),
  getDocumentSets: vi.fn(),
  getDocumentSetById: vi.fn(),
  updateDocumentSet: vi.fn(),
  deleteDocumentSet: vi.fn(),
  addDocumentsToSet: vi.fn(),
  removeDocumentFromSet: vi.fn(),
  getDocumentSetMembers: vi.fn(),
  getDocumentSetsForConversation: vi.fn(),
  linkDocumentSetToConversation: vi.fn(),
  unlinkDocumentSetFromConversation: vi.fn(),
};

vi.mock("../../src/services/documentSets.service.js", () => mockService);

// ─── Helpers ────────────────────────────────────────────────────────────────

const registeredRoutes: Record<string, { handler: Function; preHandler?: Function }> = {};

function createFastifyInstance(): any {
  const register = (method: string) =>
    vi.fn((path: string, opts: any, handler?: Function) => {
      const h = handler ?? opts;
      const pre = handler ? opts?.preHandler : undefined;
      registeredRoutes[`${method.toUpperCase()} ${path}`] = { handler: h, preHandler: pre };
    });

  return {
    register: vi.fn().mockResolvedValue(undefined),
    addHook: vi.fn().mockReturnThis(),
    get: register("GET"),
    post: register("POST"),
    put: register("PUT"),
    patch: register("PATCH"),
    delete: register("DELETE"),
  };
}

function createRequest(overrides: any = {}) {
  return {
    params: {},
    body: {},
    query: {},
    userId: 1,
    headers: { authorization: "Bearer token" },
    ...overrides,
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

// ─── Setup ──────────────────────────────────────────────────────────────────

let documentSetsPlugin: any;

beforeEach(async () => {
  vi.clearAllMocks();
  for (const key of Object.keys(registeredRoutes)) {
    delete registeredRoutes[key];
  }

  const mod = await import("../../src/routes/documentSets.js");
  documentSetsPlugin = mod.default;
  const fastify = createFastifyInstance();
  await documentSetsPlugin(fastify);
});

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("Document Sets Routes", () => {
  // ──────────── POST / ──────────────────────────────────────────────────────
  describe("POST /", () => {
    it("creates a document set", async () => {
      mockService.createDocumentSet.mockResolvedValueOnce({ id: "uuid-1" });

      const { handler } = registeredRoutes["POST /"];
      const result = await handler(
        createRequest({ body: { name: "Legal Docs", description: "Legal stuff" } }),
        createReply(),
      );

      expect(result).toEqual({ success: true, id: "uuid-1" });
      expect(mockService.createDocumentSet).toHaveBeenCalledWith({
        name: "Legal Docs",
        description: "Legal stuff",
        userId: 1,
        isPublic: undefined,
      });
    });

    it("throws 400 when name is missing", async () => {
      const { handler } = registeredRoutes["POST /"];
      await expect(
        handler(createRequest({ body: {} }), createReply()),
      ).rejects.toThrow("name is required");
    });
  });

  // ──────────── GET / ───────────────────────────────────────────────────────
  describe("GET /", () => {
    it("returns list of document sets", async () => {
      const sets = [
        { id: "s1", name: "Legal", userId: 1 },
        { id: "s2", name: "Q3 Reports", userId: 1 },
      ];
      mockService.getDocumentSets.mockResolvedValueOnce(sets);

      const { handler } = registeredRoutes["GET /"];
      const result = await handler(createRequest(), createReply());

      expect(result).toEqual(sets);
      expect(mockService.getDocumentSets).toHaveBeenCalledWith(1);
    });
  });

  // ──────────── GET /:id ────────────────────────────────────────────────────
  describe("GET /:id", () => {
    it("returns a document set with member count", async () => {
      const set = { id: "s1", name: "Legal", memberCount: 3 };
      mockService.getDocumentSetById.mockResolvedValueOnce(set);

      const { handler } = registeredRoutes["GET /:id"];
      const result = await handler(
        createRequest({ params: { id: "s1" } }),
        createReply(),
      );

      expect(result).toEqual(set);
      expect(mockService.getDocumentSetById).toHaveBeenCalledWith("s1", 1);
    });

    it("throws 404 when not found", async () => {
      mockService.getDocumentSetById.mockResolvedValueOnce(null);

      const { handler } = registeredRoutes["GET /:id"];
      await expect(
        handler(createRequest({ params: { id: "nonexistent" } }), createReply()),
      ).rejects.toThrow("Document set not found");
    });
  });

  // ──────────── PUT /:id ────────────────────────────────────────────────────
  describe("PUT /:id", () => {
    it("updates a document set", async () => {
      mockService.updateDocumentSet.mockResolvedValueOnce(true);

      const { handler } = registeredRoutes["PUT /:id"];
      const result = await handler(
        createRequest({ params: { id: "s1" }, body: { name: "Renamed" } }),
        createReply(),
      );

      expect(result).toEqual({ success: true });
      expect(mockService.updateDocumentSet).toHaveBeenCalledWith("s1", 1, {
        name: "Renamed",
      });
    });

    it("throws 404 when set not found or not owned", async () => {
      mockService.updateDocumentSet.mockResolvedValueOnce(false);

      const { handler } = registeredRoutes["PUT /:id"];
      await expect(
        handler(createRequest({ params: { id: "s1" }, body: { name: "X" } }), createReply()),
      ).rejects.toThrow("not found or not owned");
    });
  });

  // ──────────── DELETE /:id ─────────────────────────────────────────────────
  describe("DELETE /:id", () => {
    it("deletes a document set", async () => {
      mockService.deleteDocumentSet.mockResolvedValueOnce(true);

      const { handler } = registeredRoutes["DELETE /:id"];
      const result = await handler(
        createRequest({ params: { id: "s1" } }),
        createReply(),
      );

      expect(result).toEqual({ success: true });
    });

    it("throws 404 when set not found or not owned", async () => {
      mockService.deleteDocumentSet.mockResolvedValueOnce(false);

      const { handler } = registeredRoutes["DELETE /:id"];
      await expect(
        handler(createRequest({ params: { id: "s1" } }), createReply()),
      ).rejects.toThrow("not found or not owned");
    });
  });

  // ──────────── POST /:id/members ───────────────────────────────────────────
  describe("POST /:id/members", () => {
    it("adds documents to a set", async () => {
      mockService.addDocumentsToSet.mockResolvedValueOnce({ addedCount: 2 });

      const { handler } = registeredRoutes["POST /:id/members"];
      const result = await handler(
        createRequest({
          params: { id: "s1" },
          body: { documentIds: ["d1", "d2"] },
        }),
        createReply(),
      );

      expect(result).toEqual({ success: true, addedCount: 2 });
      expect(mockService.addDocumentsToSet).toHaveBeenCalledWith("s1", ["d1", "d2"], 1);
    });

    it("throws 400 when documentIds is missing", async () => {
      const { handler } = registeredRoutes["POST /:id/members"];
      await expect(
        handler(createRequest({ params: { id: "s1" }, body: {} }), createReply()),
      ).rejects.toThrow("documentIds array is required");
    });

    it("throws 400 when documentIds is empty", async () => {
      const { handler } = registeredRoutes["POST /:id/members"];
      await expect(
        handler(
          createRequest({ params: { id: "s1" }, body: { documentIds: [] } }),
          createReply(),
        ),
      ).rejects.toThrow("documentIds array is required");
    });
  });

  // ──────────── DELETE /:id/members/:documentId ─────────────────────────────
  describe("DELETE /:id/members/:documentId", () => {
    it("removes a document from a set", async () => {
      mockService.removeDocumentFromSet.mockResolvedValueOnce(undefined);

      const { handler } = registeredRoutes["DELETE /:id/members/:documentId"];
      const result = await handler(
        createRequest({ params: { id: "s1", documentId: "d1" } }),
        createReply(),
      );

      expect(result).toEqual({ success: true });
      expect(mockService.removeDocumentFromSet).toHaveBeenCalledWith("s1", "d1", 1);
    });
  });

  // ──────────── GET /:id/members ────────────────────────────────────────────
  describe("GET /:id/members", () => {
    it("lists documents in a set", async () => {
      const members = [
        { id: "m1", documentId: "d1", documentTitle: "Doc 1" },
      ];
      mockService.getDocumentSetMembers.mockResolvedValueOnce(members);

      const { handler } = registeredRoutes["GET /:id/members"];
      const result = await handler(
        createRequest({ params: { id: "s1" } }),
        createReply(),
      );

      expect(result).toEqual(members);
      expect(mockService.getDocumentSetMembers).toHaveBeenCalledWith("s1", 1);
    });
  });

  // ──────────── POST /:id/link/:conversationId ─────────────────────────────
  describe("POST /:id/link/:conversationId", () => {
    it("links a set to a conversation", async () => {
      mockService.linkDocumentSetToConversation.mockResolvedValueOnce(undefined);

      const { handler } = registeredRoutes["POST /:id/link/:conversationId"];
      const result = await handler(
        createRequest({ params: { id: "s1", conversationId: "c1" } }),
        createReply(),
      );

      expect(result).toEqual({ success: true });
      expect(mockService.linkDocumentSetToConversation).toHaveBeenCalledWith("c1", "s1");
    });
  });

  // ──────────── DELETE /:id/link/:conversationId ────────────────────────────
  describe("DELETE /:id/link/:conversationId", () => {
    it("unlinks a set from a conversation", async () => {
      mockService.unlinkDocumentSetFromConversation.mockResolvedValueOnce(undefined);

      const { handler } = registeredRoutes["DELETE /:id/link/:conversationId"];
      const result = await handler(
        createRequest({ params: { id: "s1", conversationId: "c1" } }),
        createReply(),
      );

      expect(result).toEqual({ success: true });
      expect(mockService.unlinkDocumentSetFromConversation).toHaveBeenCalledWith("c1", "s1");
    });
  });

  // ──────────── Auth preHandler ─────────────────────────────────────────────
  describe("Auth preHandler", () => {
    it("all routes have fastifyRequireAuth preHandler", () => {
      for (const [routeKey, route] of Object.entries(registeredRoutes)) {
        expect(route.preHandler, `${routeKey} should have preHandler`).toBeDefined();
      }
    });
  });
});
