import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";

// ── Mock drizzle db ──────────────────────────────────────────────────────────
const mockOrderBy = vi.fn().mockResolvedValue([]);
const mockLimit = vi.fn().mockResolvedValue([]);
const mockWhere = vi.fn().mockReturnValue({ limit: mockLimit, orderBy: mockOrderBy });
const mockFrom = vi.fn().mockReturnValue({ where: mockWhere });
const mockSelect = vi.fn().mockReturnValue({ from: mockFrom });
const mockDeleteWhere = vi.fn().mockResolvedValue(undefined);
const mockDelete = vi.fn().mockReturnValue({ where: mockDeleteWhere });

vi.mock("../../src/lib/drizzle.js", () => ({
  db: {
    select: (...args: any[]) => mockSelect(...args),
    delete: (...args: any[]) => mockDelete(...args),
  },
}));

// ── Mock drizzle-orm ─────────────────────────────────────────────────────────
vi.mock("drizzle-orm", () => ({
  eq: vi.fn((a: any, b: any) => ({ _type: "eq", field: a, value: b })),
  and: vi.fn((...args: any[]) => ({ _type: "and", conditions: args })),
  desc: vi.fn((col: any) => ({ _type: "desc", column: col })),
}));

// ── Mock db schema ───────────────────────────────────────────────────────────
vi.mock("../../src/db/schema/repos.js", () => ({
  codeRepositories: {
    id: "id",
    source: "source",
    repoUrl: "repoUrl",
    name: "name",
    indexed: "indexed",
    fileCount: "fileCount",
    createdAt: "createdAt",
    userId: "userId",
  },
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

// ── Mock fastifyAuth middleware ───────────────────────────────────────────────
vi.mock("../../src/middleware/fastifyAuth.js", () => ({
  fastifyRequireAuth: vi.fn().mockImplementation(async () => {}),
}));

// ── Mock repoSearch service ──────────────────────────────────────────────────
const mockSearchRepo = vi.fn().mockResolvedValue([]);
vi.mock("../../src/services/repoSearch.service.js", () => ({
  searchRepo: (...args: any[]) => mockSearchRepo(...args),
}));

// ── Mock repoQueue ───────────────────────────────────────────────────────────
const mockQueueAdd = vi.fn().mockResolvedValue(undefined);
vi.mock("../../src/queue/queues.js", () => ({
  repoQueue: {
    add: (...args: any[]) => mockQueueAdd(...args),
  },
}));

import reposPlugin from "../../src/routes/repos.js";

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
    userId: "user-1",
    ...overrides,
  };
}

// ── Register plugin ──────────────────────────────────────────────────────────
beforeAll(async () => {
  await reposPlugin(mockFastify as any, {} as any);
});

beforeEach(() => {
  vi.clearAllMocks();
});

// ── Tests ────────────────────────────────────────────────────────────────────

describe("repos routes registration", () => {
  it("registers GET /", () => {
    expect(routes["GET /"]).toBeDefined();
  });

  it("registers POST /github", () => {
    expect(routes["POST /github"]).toBeDefined();
  });

  it("registers GET /:id/status", () => {
    expect(routes["GET /:id/status"]).toBeDefined();
  });

  it("registers POST /:id/search", () => {
    expect(routes["POST /:id/search"]).toBeDefined();
  });

  it("registers DELETE /:id", () => {
    expect(routes["DELETE /:id"]).toBeDefined();
  });

  it("applies preHandler auth to all routes", () => {
    for (const key of Object.keys(routes)) {
      expect(routes[key].opts).toBeDefined();
      expect(routes[key].opts.preHandler).toBeDefined();
    }
  });
});

describe("GET / — list user repos", () => {
  it("returns repos for the authenticated user", async () => {
    const fakeRepos = [
      { id: "r1", source: "github", repoUrl: "https://github.com/a/b", name: "b", indexed: true, fileCount: 10, createdAt: "2025-01-01" },
      { id: "r2", source: "github", repoUrl: "https://github.com/a/c", name: "c", indexed: false, fileCount: 0, createdAt: "2025-01-02" },
    ];
    mockOrderBy.mockResolvedValueOnce(fakeRepos);

    const req = createMockRequest({ userId: "user-1" });
    const result = await routes["GET /"].handler(req);

    expect(mockSelect).toHaveBeenCalled();
    expect(mockFrom).toHaveBeenCalled();
    expect(mockWhere).toHaveBeenCalled();
    expect(result).toEqual({ data: fakeRepos });
  });

  it("returns empty array when user has no repos", async () => {
    mockOrderBy.mockResolvedValueOnce([]);

    const req = createMockRequest({ userId: "user-no-repos" });
    const result = await routes["GET /"].handler(req);

    expect(result).toEqual({ data: [] });
  });

  it("propagates database errors", async () => {
    mockOrderBy.mockRejectedValueOnce(new Error("DB connection failed"));

    const req = createMockRequest();
    await expect(routes["GET /"].handler(req)).rejects.toThrow("DB connection failed");
  });
});

describe("POST /github — start ingestion", () => {
  it("returns 400 when owner is missing", async () => {
    const req = createMockRequest({ body: { repo: "my-repo" } });
    const reply = createMockReply();

    const result = await routes["POST /github"].handler(req, reply);

    expect(reply.code).toHaveBeenCalledWith(400);
    expect(result).toEqual({ error: "owner and repo are required" });
    expect(mockQueueAdd).not.toHaveBeenCalled();
  });

  it("returns 400 when repo is missing", async () => {
    const req = createMockRequest({ body: { owner: "my-owner" } });
    const reply = createMockReply();

    const result = await routes["POST /github"].handler(req, reply);

    expect(reply.code).toHaveBeenCalledWith(400);
    expect(result).toEqual({ error: "owner and repo are required" });
    expect(mockQueueAdd).not.toHaveBeenCalled();
  });

  it("returns 400 when both owner and repo are missing", async () => {
    const req = createMockRequest({ body: {} });
    const reply = createMockReply();

    const result = await routes["POST /github"].handler(req, reply);

    expect(reply.code).toHaveBeenCalledWith(400);
    expect(result).toEqual({ error: "owner and repo are required" });
  });

  it("returns 400 when owner is empty string", async () => {
    const req = createMockRequest({ body: { owner: "", repo: "my-repo" } });
    const reply = createMockReply();

    const result = await routes["POST /github"].handler(req, reply);

    expect(reply.code).toHaveBeenCalledWith(400);
    expect(result).toEqual({ error: "owner and repo are required" });
  });

  it("queues ingestion and returns 202 on success", async () => {
    const req = createMockRequest({ body: { owner: "acme", repo: "widgets" }, userId: "user-1" });
    const reply = createMockReply();

    const result = await routes["POST /github"].handler(req, reply);

    expect(reply.code).toHaveBeenCalledWith(202);
    expect(mockQueueAdd).toHaveBeenCalledWith("ingest", { userId: "user-1", owner: "acme", repo: "widgets" });
    expect(result).toEqual({ message: "Ingestion queued", owner: "acme", repo: "widgets" });
  });

  it("returns 400 when owner/repo has whitespace (fails format validation)", async () => {
    const req = createMockRequest({ body: { owner: "  acme  ", repo: "  widgets  " }, userId: "user-1" });
    const reply = createMockReply();

    const result = await routes["POST /github"].handler(req, reply);

    expect(reply.code).toHaveBeenCalledWith(400);
    expect(result).toEqual({ error: "Invalid owner or repo name. Must contain only alphanumeric characters, hyphens, underscores, and dots." });
    expect(mockQueueAdd).not.toHaveBeenCalled();
  });

  it("propagates queue errors", async () => {
    mockQueueAdd.mockRejectedValueOnce(new Error("Queue unavailable"));

    const req = createMockRequest({ body: { owner: "acme", repo: "widgets" } });
    const reply = createMockReply();

    await expect(routes["POST /github"].handler(req, reply)).rejects.toThrow("Queue unavailable");
  });
});

describe("GET /:id/status — repo indexing status", () => {
  it("returns indexed status for existing repo", async () => {
    const repoStatus = { indexed: true, fileCount: 42 };
    mockLimit.mockResolvedValueOnce([repoStatus]);

    const req = createMockRequest({ params: { id: "repo-1" }, userId: "user-1" });
    const reply = createMockReply();

    const result = await routes["GET /:id/status"].handler(req, reply);

    expect(mockSelect).toHaveBeenCalled();
    expect(result).toEqual({ indexed: true, fileCount: 42 });
  });

  it("returns 404 when repo does not exist", async () => {
    mockLimit.mockResolvedValueOnce([]);

    const req = createMockRequest({ params: { id: "nonexistent" }, userId: "user-1" });
    const reply = createMockReply();

    const result = await routes["GET /:id/status"].handler(req, reply);

    expect(reply.code).toHaveBeenCalledWith(404);
    expect(result).toEqual({ error: "Repository not found" });
  });

  it("returns 404 when repo belongs to another user (not found via userId filter)", async () => {
    mockLimit.mockResolvedValueOnce([]);

    const req = createMockRequest({ params: { id: "repo-1" }, userId: "other-user" });
    const reply = createMockReply();

    const result = await routes["GET /:id/status"].handler(req, reply);

    expect(reply.code).toHaveBeenCalledWith(404);
    expect(result).toEqual({ error: "Repository not found" });
  });

  it("propagates database errors", async () => {
    mockLimit.mockRejectedValueOnce(new Error("DB error"));

    const req = createMockRequest({ params: { id: "repo-1" } });
    const reply = createMockReply();

    await expect(routes["GET /:id/status"].handler(req, reply)).rejects.toThrow("DB error");
  });
});

describe("POST /:id/search — search repo files", () => {
  it("returns 400 when query is missing", async () => {
    const req = createMockRequest({ params: { id: "repo-1" }, body: {} });
    const reply = createMockReply();

    const result = await routes["POST /:id/search"].handler(req, reply);

    expect(reply.code).toHaveBeenCalledWith(400);
    expect(result).toEqual({ error: "query is required" });
    expect(mockSearchRepo).not.toHaveBeenCalled();
  });

  it("returns 400 when query is empty string", async () => {
    const req = createMockRequest({ params: { id: "repo-1" }, body: { query: "" } });
    const reply = createMockReply();

    const result = await routes["POST /:id/search"].handler(req, reply);

    expect(reply.code).toHaveBeenCalledWith(400);
    expect(result).toEqual({ error: "query is required" });
  });

  it("returns 404 when repo is not found", async () => {
    mockLimit.mockResolvedValueOnce([]);

    const req = createMockRequest({ params: { id: "nonexistent" }, body: { query: "hello" } });
    const reply = createMockReply();

    const result = await routes["POST /:id/search"].handler(req, reply);

    expect(reply.code).toHaveBeenCalledWith(404);
    expect(result).toEqual({ error: "Repository not found" });
    expect(mockSearchRepo).not.toHaveBeenCalled();
  });

  it("returns search results for valid request", async () => {
    const fakeRepo = { id: "repo-1", name: "test", indexed: true };
    const fakeResults = [{ file: "src/main.ts", score: 0.9 }];
    mockLimit.mockResolvedValueOnce([fakeRepo]);
    mockSearchRepo.mockResolvedValueOnce(fakeResults);

    const req = createMockRequest({ params: { id: "repo-1" }, body: { query: "main function" }, userId: "user-1" });
    const reply = createMockReply();

    const result = await routes["POST /:id/search"].handler(req, reply);

    expect(mockSearchRepo).toHaveBeenCalledWith("repo-1", "main function");
    expect(result).toEqual({ data: fakeResults });
  });

  it("propagates searchRepo errors", async () => {
    const fakeRepo = { id: "repo-1", name: "test" };
    mockLimit.mockResolvedValueOnce([fakeRepo]);
    mockSearchRepo.mockRejectedValueOnce(new Error("Search service down"));

    const req = createMockRequest({ params: { id: "repo-1" }, body: { query: "test" } });
    const reply = createMockReply();

    await expect(routes["POST /:id/search"].handler(req, reply)).rejects.toThrow("Search service down");
  });

  it("propagates database errors during repo lookup", async () => {
    mockLimit.mockRejectedValueOnce(new Error("DB timeout"));

    const req = createMockRequest({ params: { id: "repo-1" }, body: { query: "test" } });
    const reply = createMockReply();

    await expect(routes["POST /:id/search"].handler(req, reply)).rejects.toThrow("DB timeout");
  });
});

describe("DELETE /:id — delete repo", () => {
  it("returns 404 when repo is not found", async () => {
    mockLimit.mockResolvedValueOnce([]);

    const req = createMockRequest({ params: { id: "nonexistent" }, userId: "user-1" });
    const reply = createMockReply();

    const result = await routes["DELETE /:id"].handler(req, reply);

    expect(reply.code).toHaveBeenCalledWith(404);
    expect(result).toEqual({ error: "Repository not found" });
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it("deletes repo and returns success message", async () => {
    const fakeRepo = { id: "repo-1", name: "test", userId: "user-1" };
    mockLimit.mockResolvedValueOnce([fakeRepo]);

    const req = createMockRequest({ params: { id: "repo-1" }, userId: "user-1" });
    const reply = createMockReply();

    const result = await routes["DELETE /:id"].handler(req, reply);

    expect(mockDelete).toHaveBeenCalled();
    expect(mockDeleteWhere).toHaveBeenCalled();
    expect(result).toEqual({ message: "Repository deleted" });
  });

  it("returns 404 when repo belongs to another user", async () => {
    mockLimit.mockResolvedValueOnce([]);

    const req = createMockRequest({ params: { id: "repo-1" }, userId: "other-user" });
    const reply = createMockReply();

    const result = await routes["DELETE /:id"].handler(req, reply);

    expect(reply.code).toHaveBeenCalledWith(404);
    expect(result).toEqual({ error: "Repository not found" });
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it("propagates database errors during repo lookup", async () => {
    mockLimit.mockRejectedValueOnce(new Error("DB error"));

    const req = createMockRequest({ params: { id: "repo-1" } });
    const reply = createMockReply();

    await expect(routes["DELETE /:id"].handler(req, reply)).rejects.toThrow("DB error");
  });

  it("propagates database errors during deletion", async () => {
    const fakeRepo = { id: "repo-1", name: "test" };
    mockLimit.mockResolvedValueOnce([fakeRepo]);
    mockDeleteWhere.mockRejectedValueOnce(new Error("Delete failed"));

    const req = createMockRequest({ params: { id: "repo-1" } });
    const reply = createMockReply();

    await expect(routes["DELETE /:id"].handler(req, reply)).rejects.toThrow("Delete failed");
  });
});
