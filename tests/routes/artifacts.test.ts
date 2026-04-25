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
let deleteQueue: any[];
let updateQueue: any[];

const mockDb: any = {
  select: vi.fn((..._args: any[]) => {
    return selectQueue.shift() || createChain([]);
  }),
  delete: vi.fn((..._args: any[]) => {
    return deleteQueue.shift() || createChain([]);
  }),
  update: vi.fn((..._args: any[]) => {
    return updateQueue.shift() || createChain([]);
  }),
};

vi.mock("../../src/lib/drizzle.js", () => ({ db: mockDb }));

vi.mock("../../src/db/schema/research.js", () => ({
  artifacts: {
    id: "id",
    name: "name",
    type: "type",
    language: "language",
    content: "content",
    userId: "userId",
    conversationId: "conversationId",
    createdAt: "createdAt",
    updatedAt: "updatedAt",
  },
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((...a: any[]) => ["eq", ...a]),
  and: vi.fn((...a: any[]) => ["and", ...a]),
  desc: vi.fn((col: any) => ["desc", col]),
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

// ── Route-capture helper ────────────────────────────────────────────────────

const routes: Record<string, any> = {};

const mockFastify = {
  get: vi.fn((path: string, opts: any, handler?: any) => {
    routes[`GET ${path}`] = { handler: handler || opts, opts: handler ? opts : undefined };
  }),
  post: vi.fn((path: string, opts: any, handler?: any) => {
    routes[`POST ${path}`] = { handler: handler || opts, opts: handler ? opts : undefined };
  }),
  put: vi.fn((path: string, opts: any, handler?: any) => {
    routes[`PUT ${path}`] = { handler: handler || opts, opts: handler ? opts : undefined };
  }),
  delete: vi.fn((path: string, opts: any, handler?: any) => {
    routes[`DELETE ${path}`] = { handler: handler || opts, opts: handler ? opts : undefined };
  }),
};

// ── Helpers ─────────────────────────────────────────────────────────────────

function makeRequest(overrides: Record<string, any> = {}): any {
  return { userId: "user-1", query: {}, params: {}, body: {}, ...overrides };
}

function makeReply(): any {
  return {
    code: vi.fn().mockReturnThis(),
    send: vi.fn().mockReturnThis(),
    header: vi.fn().mockReturnThis(),
  };
}

const SAMPLE_ARTIFACT = {
  id: "art-1",
  name: "hello world",
  type: "code",
  language: "typescript",
  content: "console.log('hello');",
  userId: "user-1",
  conversationId: "conv-1",
  createdAt: new Date("2025-01-01"),
  updatedAt: new Date("2025-01-02"),
};

describe("Artifacts Routes", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    selectQueue = [];
    deleteQueue = [];
    updateQueue = [];

    Object.keys(routes).forEach((k) => delete routes[k]);
    const mod = await import("../../src/routes/artifacts.js");
    await (mod.default as any)(mockFastify as any);
  });

  // ── Route registration ──────────────────────────────────────────────────

  describe("route registration", () => {
    it("registers GET / with auth preHandler", () => {
      expect(routes["GET /"]).toBeDefined();
      expect(routes["GET /"].opts?.preHandler).toBeDefined();
    });

    it("registers GET /:id with auth preHandler", () => {
      expect(routes["GET /:id"]).toBeDefined();
      expect(routes["GET /:id"].opts?.preHandler).toBeDefined();
    });

    it("registers PUT /:id with auth preHandler", () => {
      expect(routes["PUT /:id"]).toBeDefined();
      expect(routes["PUT /:id"].opts?.preHandler).toBeDefined();
    });

    it("registers DELETE /:id with auth preHandler", () => {
      expect(routes["DELETE /:id"]).toBeDefined();
      expect(routes["DELETE /:id"].opts?.preHandler).toBeDefined();
    });

    it("registers GET /:id/download with auth preHandler", () => {
      expect(routes["GET /:id/download"]).toBeDefined();
      expect(routes["GET /:id/download"].opts?.preHandler).toBeDefined();
    });
  });

  // ── GET / (list artifacts) ──────────────────────────────────────────────

  describe("GET /", () => {
    const handler = () => routes["GET /"].handler;

    it("returns artifacts for the user", async () => {
      const rows = [
        { id: "art-1", name: "a", type: "code", language: "ts", conversationId: "c1", createdAt: new Date(), updatedAt: new Date() },
        { id: "art-2", name: "b", type: "html", language: null, conversationId: "c2", createdAt: new Date(), updatedAt: new Date() },
      ];
      selectQueue.push(createChain(rows));

      const result = await handler()(makeRequest(), makeReply());
      expect(result).toEqual({ artifacts: rows });
    });

    it("returns empty array when user has no artifacts", async () => {
      selectQueue.push(createChain([]));

      const result = await handler()(makeRequest(), makeReply());
      expect(result).toEqual({ artifacts: [] });
    });

    it("passes conversation_id filter when provided", async () => {
      selectQueue.push(createChain([]));

      await handler()(
        makeRequest({ query: { conversation_id: "conv-123" } }),
        makeReply(),
      );
      expect(mockDb.select).toHaveBeenCalled();
    });

    it("passes type filter when provided", async () => {
      selectQueue.push(createChain([]));

      await handler()(
        makeRequest({ query: { type: "html" } }),
        makeReply(),
      );
      expect(mockDb.select).toHaveBeenCalled();
    });

    it("passes both filters when both provided", async () => {
      selectQueue.push(createChain([]));

      await handler()(
        makeRequest({ query: { conversation_id: "conv-1", type: "code" } }),
        makeReply(),
      );
      expect(mockDb.select).toHaveBeenCalled();
    });
  });

  // ── GET /:id (get artifact) ─────────────────────────────────────────────

  describe("GET /:id", () => {
    const handler = () => routes["GET /:id"].handler;

    it("returns the artifact when found", async () => {
      selectQueue.push(createChain([SAMPLE_ARTIFACT]));

      const result = await handler()(
        makeRequest({ params: { id: "art-1" } }),
        makeReply(),
      );
      expect(result).toEqual(SAMPLE_ARTIFACT);
    });

    it("throws 404 when artifact is not found", async () => {
      selectQueue.push(createChain([]));

      await expect(
        handler()(makeRequest({ params: { id: "nonexistent" } }), makeReply()),
      ).rejects.toThrow("Artifact not found");
    });

    it("thrown error has statusCode 404", async () => {
      selectQueue.push(createChain([]));

      try {
        await handler()(makeRequest({ params: { id: "nonexistent" } }), makeReply());
        expect.fail("should have thrown");
      } catch (err: any) {
        expect(err.statusCode).toBe(404);
        expect(err.code).toBe("ARTIFACT_NOT_FOUND");
      }
    });
  });

  // ── PUT /:id (update artifact) ──────────────────────────────────────────

  describe("PUT /:id", () => {
    const handler = () => routes["PUT /:id"].handler;

    it("updates name and content when both provided", async () => {
      const updated = { ...SAMPLE_ARTIFACT, name: "new name", content: "new content" };
      selectQueue.push(createChain([SAMPLE_ARTIFACT]));
      updateQueue.push(createChain([updated]));

      const result = await handler()(
        makeRequest({ params: { id: "art-1" }, body: { name: "new name", content: "new content" } }),
        makeReply(),
      );
      expect(result).toEqual(updated);
    });

    it("updates only name when content is not provided", async () => {
      const updated = { ...SAMPLE_ARTIFACT, name: "renamed" };
      selectQueue.push(createChain([SAMPLE_ARTIFACT]));
      updateQueue.push(createChain([updated]));

      const result = await handler()(
        makeRequest({ params: { id: "art-1" }, body: { name: "renamed" } }),
        makeReply(),
      );
      expect(result).toEqual(updated);
    });

    it("updates only content when name is not provided", async () => {
      const updated = { ...SAMPLE_ARTIFACT, content: "updated" };
      selectQueue.push(createChain([SAMPLE_ARTIFACT]));
      updateQueue.push(createChain([updated]));

      const result = await handler()(
        makeRequest({ params: { id: "art-1" }, body: { content: "updated" } }),
        makeReply(),
      );
      expect(result).toEqual(updated);
    });

    it("throws 404 when artifact does not exist", async () => {
      selectQueue.push(createChain([]));

      await expect(
        handler()(makeRequest({ params: { id: "missing" }, body: { name: "x" } }), makeReply()),
      ).rejects.toThrow("Artifact not found");
    });

    it("thrown error on missing artifact has correct code", async () => {
      selectQueue.push(createChain([]));

      try {
        await handler()(makeRequest({ params: { id: "missing" }, body: {} }), makeReply());
        expect.fail("should have thrown");
      } catch (err: any) {
        expect(err.statusCode).toBe(404);
        expect(err.code).toBe("ARTIFACT_NOT_FOUND");
      }
    });
  });

  // ── DELETE /:id ─────────────────────────────────────────────────────────

  describe("DELETE /:id", () => {
    const handler = () => routes["DELETE /:id"].handler;

    it("deletes the artifact and returns success", async () => {
      selectQueue.push(createChain([SAMPLE_ARTIFACT]));
      deleteQueue.push(createChain());

      const result = await handler()(
        makeRequest({ params: { id: "art-1" } }),
        makeReply(),
      );
      expect(result).toEqual({ success: true });
    });

    it("calls db.delete with the correct artifact", async () => {
      selectQueue.push(createChain([SAMPLE_ARTIFACT]));
      deleteQueue.push(createChain());

      await handler()(makeRequest({ params: { id: "art-1" } }), makeReply());
      expect(mockDb.delete).toHaveBeenCalled();
    });

    it("throws 404 when artifact does not exist", async () => {
      selectQueue.push(createChain([]));

      await expect(
        handler()(makeRequest({ params: { id: "gone" } }), makeReply()),
      ).rejects.toThrow("Artifact not found");
    });

    it("thrown error on missing artifact has correct code", async () => {
      selectQueue.push(createChain([]));

      try {
        await handler()(makeRequest({ params: { id: "gone" } }), makeReply());
        expect.fail("should have thrown");
      } catch (err: any) {
        expect(err.statusCode).toBe(404);
        expect(err.code).toBe("ARTIFACT_NOT_FOUND");
      }
    });
  });

  // ── GET /:id/download ──────────────────────────────────────────────────

  describe("GET /:id/download", () => {
    const handler = () => routes["GET /:id/download"].handler;

    it("returns content with correct headers for code/typescript artifact", async () => {
      selectQueue.push(createChain([SAMPLE_ARTIFACT]));
      const reply = makeReply();

      await handler()(makeRequest({ params: { id: "art-1" } }), reply);

      expect(reply.header).toHaveBeenCalledWith("Content-Type", "text/plain");
      expect(reply.header).toHaveBeenCalledWith(
        "Content-Disposition",
        'attachment; filename="hello_world.ts"',
      );
      expect(reply.send).toHaveBeenCalledWith("console.log('hello');");
    });

    it("uses language extension for code type artifacts", async () => {
      const pyArtifact = { ...SAMPLE_ARTIFACT, language: "python", name: "script" };
      selectQueue.push(createChain([pyArtifact]));
      const reply = makeReply();

      await handler()(makeRequest({ params: { id: "art-1" } }), reply);

      expect(reply.header).toHaveBeenCalledWith(
        "Content-Disposition",
        'attachment; filename="script.py"',
      );
    });

    it("falls back to .txt for code with unknown language", async () => {
      const unknownLang = { ...SAMPLE_ARTIFACT, language: "brainfuck", name: "weird" };
      selectQueue.push(createChain([unknownLang]));
      const reply = makeReply();

      await handler()(makeRequest({ params: { id: "art-1" } }), reply);

      expect(reply.header).toHaveBeenCalledWith(
        "Content-Disposition",
        'attachment; filename="weird.txt"',
      );
    });

    it("falls back to .txt for code with null language", async () => {
      const noLang = { ...SAMPLE_ARTIFACT, language: null, name: "noext" };
      selectQueue.push(createChain([noLang]));
      const reply = makeReply();

      await handler()(makeRequest({ params: { id: "art-1" } }), reply);

      expect(reply.header).toHaveBeenCalledWith(
        "Content-Disposition",
        'attachment; filename="noext.txt"',
      );
    });

    it("uses correct MIME type and extension for html type", async () => {
      const htmlArtifact = { ...SAMPLE_ARTIFACT, type: "html", language: null, name: "page" };
      selectQueue.push(createChain([htmlArtifact]));
      const reply = makeReply();

      await handler()(makeRequest({ params: { id: "art-1" } }), reply);

      expect(reply.header).toHaveBeenCalledWith("Content-Type", "text/html");
      expect(reply.header).toHaveBeenCalledWith(
        "Content-Disposition",
        'attachment; filename="page.html"',
      );
    });

    it("uses correct MIME type and extension for markdown type", async () => {
      const mdArtifact = { ...SAMPLE_ARTIFACT, type: "markdown", language: null, name: "doc" };
      selectQueue.push(createChain([mdArtifact]));
      const reply = makeReply();

      await handler()(makeRequest({ params: { id: "art-1" } }), reply);

      expect(reply.header).toHaveBeenCalledWith("Content-Type", "text/markdown");
      expect(reply.header).toHaveBeenCalledWith(
        "Content-Disposition",
        'attachment; filename="doc.md"',
      );
    });

    it("uses correct MIME type and extension for json type", async () => {
      const jsonArtifact = { ...SAMPLE_ARTIFACT, type: "json", language: null, name: "data" };
      selectQueue.push(createChain([jsonArtifact]));
      const reply = makeReply();

      await handler()(makeRequest({ params: { id: "art-1" } }), reply);

      expect(reply.header).toHaveBeenCalledWith("Content-Type", "application/json");
      expect(reply.header).toHaveBeenCalledWith(
        "Content-Disposition",
        'attachment; filename="data.json"',
      );
    });

    it("uses correct MIME type and extension for csv type", async () => {
      const csvArtifact = { ...SAMPLE_ARTIFACT, type: "csv", language: null, name: "export" };
      selectQueue.push(createChain([csvArtifact]));
      const reply = makeReply();

      await handler()(makeRequest({ params: { id: "art-1" } }), reply);

      expect(reply.header).toHaveBeenCalledWith("Content-Type", "text/csv");
      expect(reply.header).toHaveBeenCalledWith(
        "Content-Disposition",
        'attachment; filename="export.csv"',
      );
    });

    it("falls back to text/plain and .txt for unknown type", async () => {
      const unknownType = { ...SAMPLE_ARTIFACT, type: "diagram", language: null, name: "chart" };
      selectQueue.push(createChain([unknownType]));
      const reply = makeReply();

      await handler()(makeRequest({ params: { id: "art-1" } }), reply);

      expect(reply.header).toHaveBeenCalledWith("Content-Type", "text/plain");
      expect(reply.header).toHaveBeenCalledWith(
        "Content-Disposition",
        'attachment; filename="chart.txt"',
      );
    });

    it("sanitizes filename by replacing special characters with underscores", async () => {
      const specialName = { ...SAMPLE_ARTIFACT, name: "my file (v2) [final]", language: "javascript" };
      selectQueue.push(createChain([specialName]));
      const reply = makeReply();

      await handler()(makeRequest({ params: { id: "art-1" } }), reply);

      expect(reply.header).toHaveBeenCalledWith(
        "Content-Disposition",
        'attachment; filename="my_file__v2___final_.js"',
      );
    });

    it("throws 404 when artifact does not exist", async () => {
      selectQueue.push(createChain([]));

      await expect(
        handler()(makeRequest({ params: { id: "missing" } }), makeReply()),
      ).rejects.toThrow("Artifact not found");
    });

    it("thrown error on missing artifact has correct code", async () => {
      selectQueue.push(createChain([]));

      try {
        await handler()(makeRequest({ params: { id: "missing" } }), makeReply());
        expect.fail("should have thrown");
      } catch (err: any) {
        expect(err.statusCode).toBe(404);
        expect(err.code).toBe("ARTIFACT_NOT_FOUND");
      }
    });

    it("handles all known code languages", async () => {
      const langMap: Record<string, string> = {
        javascript: "js",
        typescript: "ts",
        python: "py",
        ruby: "rb",
        go: "go",
        rust: "rs",
        java: "java",
        "c++": "cpp",
        c: "c",
        bash: "sh",
        sql: "sql",
        html: "html",
        css: "css",
      };

      for (const [lang, ext] of Object.entries(langMap)) {
        selectQueue.push(createChain([{ ...SAMPLE_ARTIFACT, language: lang, name: "file" }]));
        const reply = makeReply();

        await handler()(makeRequest({ params: { id: "art-1" } }), reply);

        expect(reply.header).toHaveBeenCalledWith(
          "Content-Disposition",
          `attachment; filename="file.${ext}"`,
        );
      }
    });
  });
});
