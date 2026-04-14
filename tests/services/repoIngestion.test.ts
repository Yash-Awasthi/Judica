import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock logger
vi.mock("../../src/lib/logger.js", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// Mock env
vi.mock("../../src/config/env.js", () => ({
  env: {
    DATABASE_URL: "postgresql://test:test@localhost:5432/test",
    JWT_SECRET: "test-jwt-secret-min-16-chars",
    MASTER_ENCRYPTION_KEY: "test-master-encryption-key-min-32-characters-long",
  },
}));

// Mock db pool
const mockPoolQuery = vi.fn();
vi.mock("../../src/lib/db.js", () => ({
  pool: { query: (...args: unknown[]) => mockPoolQuery(...args) },
}));

// Mock drizzle
const mockInsertReturning = vi.fn();
const mockUpdateWhere = vi.fn();
vi.mock("../../src/lib/drizzle.js", () => ({
  db: {
    insert: () => ({
      values: () => ({
        returning: () => mockInsertReturning(),
      }),
    }),
    update: () => ({
      set: () => ({
        where: (...args: unknown[]) => mockUpdateWhere(...args),
      }),
    }),
  },
}));

// Mock repos schema
vi.mock("../../src/db/schema/repos.js", () => ({
  codeRepositories: { id: "id" },
}));

// Mock drizzle-orm
vi.mock("drizzle-orm", () => ({
  eq: vi.fn((...args: unknown[]) => ({ type: "eq", args })),
}));

// Mock embed
const mockEmbed = vi.fn();
vi.mock("../../src/services/embeddings.service.js", () => ({
  embed: (...args: unknown[]) => mockEmbed(...args),
}));

// Mock Octokit
const mockGetTree = vi.fn();
const mockGetBlob = vi.fn();
vi.mock("@octokit/rest", () => ({
  Octokit: class MockOctokit {
    git = {
      getTree: (...args: unknown[]) => mockGetTree(...args),
      getBlob: (...args: unknown[]) => mockGetBlob(...args),
    };
  },
}));

describe("repoIngestion.service", () => {
  const REPO_ID = "test-repo-id-123";

  beforeEach(() => {
    vi.clearAllMocks();
    mockInsertReturning.mockResolvedValue([{ id: REPO_ID }]);
    mockUpdateWhere.mockResolvedValue(undefined);
    mockPoolQuery.mockResolvedValue({ rows: [] });
  });

  it("ingests a GitHub repo with supported files", async () => {
    vi.resetModules();

    mockGetTree.mockResolvedValue({
      data: {
        tree: [
          { type: "blob", path: "src/index.ts", sha: "abc123" },
          { type: "blob", path: "README.md", sha: "def456" },
          { type: "blob", path: "image.png", sha: "skip-me" }, // unsupported extension
        ],
      },
    });

    mockGetBlob
      .mockResolvedValueOnce({
        data: { content: Buffer.from("console.log('hello')").toString("base64") },
      })
      .mockResolvedValueOnce({
        data: { content: Buffer.from("# README").toString("base64") },
      });

    mockEmbed.mockResolvedValue([0.1, 0.2, 0.3]);

    const { ingestGitHubRepo } = await import("../../src/services/repoIngestion.service.js");
    const repoId = await ingestGitHubRepo(1, "testowner", "testrepo");

    expect(repoId).toBe(REPO_ID);
    expect(mockGetTree).toHaveBeenCalledWith({
      owner: "testowner",
      repo: "testrepo",
      tree_sha: "HEAD",
      recursive: "true",
    });
    // Should only process 2 files (ts and md), not png
    expect(mockGetBlob).toHaveBeenCalledTimes(2);
    expect(mockPoolQuery).toHaveBeenCalledTimes(2);
    // Update should mark as indexed
    expect(mockUpdateWhere).toHaveBeenCalled();
  });

  it("skips empty files", async () => {
    vi.resetModules();

    mockGetTree.mockResolvedValue({
      data: {
        tree: [
          { type: "blob", path: "empty.ts", sha: "empty123" },
        ],
      },
    });

    mockGetBlob.mockResolvedValue({
      data: { content: Buffer.from("   ").toString("base64") },
    });

    const { ingestGitHubRepo } = await import("../../src/services/repoIngestion.service.js");
    await ingestGitHubRepo(1, "owner", "repo");

    // Should not insert into DB since content is blank
    expect(mockPoolQuery).not.toHaveBeenCalled();
  });

  it("truncates content to MAX_CONTENT_LENGTH", async () => {
    vi.resetModules();

    const longContent = "x".repeat(10000);
    mockGetTree.mockResolvedValue({
      data: {
        tree: [{ type: "blob", path: "big.ts", sha: "big123" }],
      },
    });

    mockGetBlob.mockResolvedValue({
      data: { content: Buffer.from(longContent).toString("base64") },
    });

    mockEmbed.mockResolvedValue([0.1, 0.2]);

    const { ingestGitHubRepo } = await import("../../src/services/repoIngestion.service.js");
    await ingestGitHubRepo(1, "owner", "repo");

    // Verify the content passed to pool.query is truncated
    expect(mockPoolQuery).toHaveBeenCalledTimes(1);
    const insertedContent = mockPoolQuery.mock.calls[0][1][3]; // 4th param is content
    expect(insertedContent.length).toBeLessThanOrEqual(5000);
  });

  it("filters tree to only supported extensions", async () => {
    vi.resetModules();

    mockGetTree.mockResolvedValue({
      data: {
        tree: [
          { type: "blob", path: "app.ts", sha: "a1" },
          { type: "blob", path: "style.css", sha: "a2" },  // unsupported
          { type: "blob", path: "main.py", sha: "a3" },
          { type: "blob", path: "data.csv", sha: "a4" },   // unsupported
          { type: "blob", path: "lib.go", sha: "a5" },
          { type: "tree", path: "src", sha: "a6" },         // directory, not blob
        ],
      },
    });

    mockGetBlob.mockResolvedValue({
      data: { content: Buffer.from("code content").toString("base64") },
    });
    mockEmbed.mockResolvedValue([0.1]);

    const { ingestGitHubRepo } = await import("../../src/services/repoIngestion.service.js");
    await ingestGitHubRepo(1, "owner", "repo");

    // Only .ts, .py, .go should be fetched (3 blobs)
    expect(mockGetBlob).toHaveBeenCalledTimes(3);
  });

  it("handles individual file failure gracefully", async () => {
    vi.resetModules();

    mockGetTree.mockResolvedValue({
      data: {
        tree: [
          { type: "blob", path: "good.ts", sha: "good1" },
          { type: "blob", path: "bad.ts", sha: "bad1" },
        ],
      },
    });

    mockGetBlob
      .mockResolvedValueOnce({
        data: { content: Buffer.from("good code").toString("base64") },
      })
      .mockRejectedValueOnce(new Error("API rate limited"));

    mockEmbed.mockResolvedValue([0.1]);

    const { ingestGitHubRepo } = await import("../../src/services/repoIngestion.service.js");
    const repoId = await ingestGitHubRepo(1, "owner", "repo");

    expect(repoId).toBe(REPO_ID);
    // Only the good file should have been inserted
    expect(mockPoolQuery).toHaveBeenCalledTimes(1);
  });

  it("throws and marks repo as failed on total failure", async () => {
    vi.resetModules();

    mockGetTree.mockRejectedValue(new Error("Not Found"));

    const { ingestGitHubRepo } = await import("../../src/services/repoIngestion.service.js");

    await expect(ingestGitHubRepo(1, "owner", "nonexistent")).rejects.toThrow("Not Found");
    // Should mark repo as not indexed
    expect(mockUpdateWhere).toHaveBeenCalled();
  });

  it("correctly maps file extensions to languages", async () => {
    vi.resetModules();

    mockGetTree.mockResolvedValue({
      data: {
        tree: [
          { type: "blob", path: "app.tsx", sha: "t1" },
          { type: "blob", path: "lib.rs", sha: "t2" },
          { type: "blob", path: "config.yaml", sha: "t3" },
        ],
      },
    });

    mockGetBlob.mockResolvedValue({
      data: { content: Buffer.from("content").toString("base64") },
    });
    mockEmbed.mockResolvedValue([0.5]);

    const { ingestGitHubRepo } = await import("../../src/services/repoIngestion.service.js");
    await ingestGitHubRepo(1, "owner", "repo");

    // Check language field (3rd param in SQL insert)
    const languages = mockPoolQuery.mock.calls.map((call: any) => call[1][2]);
    expect(languages).toContain("typescript");
    expect(languages).toContain("rust");
    expect(languages).toContain("yaml");
  });
});
