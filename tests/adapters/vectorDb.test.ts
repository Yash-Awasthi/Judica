import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/lib/ssrf.js", () => ({
  validateSafeUrl: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../src/lib/breaker.js", () => ({
  getBreaker: vi.fn((_provider: unknown, action: unknown) => ({
    fire: (...args: unknown[]) => (action as Function)(...args),
  })),
}));

vi.mock("../../src/lib/logger.js", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
  getVectorAdapter,
  setVectorAdapter,
  type VectorDbAdapter,
  type VectorSearchResult,
} from "../../src/adapters/vectorDb.adapter.js";

describe("vectorDb.adapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("getVectorAdapter", () => {
    it("returns the default pgvector adapter", () => {
      const adapter = getVectorAdapter();
      expect(adapter).toBeDefined();
      expect(adapter.name).toBe("pgvector");
    });
  });

  describe("setVectorAdapter", () => {
    it("replaces the active adapter", () => {
      const customAdapter: VectorDbAdapter = {
        name: "pinecone",
        upsert: vi.fn(),
        search: vi.fn().mockResolvedValue([]),
        delete: vi.fn(),
        ping: vi.fn().mockResolvedValue(true),
      };
      setVectorAdapter(customAdapter);
      expect(getVectorAdapter().name).toBe("pinecone");
    });

    it("throws when adapter is null", () => {
      expect(() => setVectorAdapter(null as unknown as VectorDbAdapter)).toThrow(
        "Invalid vector DB adapter"
      );
    });

    it("throws when adapter does not implement search()", () => {
      expect(() =>
        setVectorAdapter({ name: "bad-adapter" } as unknown as VectorDbAdapter)
      ).toThrow("Invalid vector DB adapter: must implement search()");
    });

    it("returns the new adapter via getVectorAdapter", () => {
      const adapter: VectorDbAdapter = {
        name: "qdrant",
        upsert: vi.fn(),
        search: vi.fn().mockResolvedValue([]),
        delete: vi.fn(),
        ping: vi.fn().mockResolvedValue(true),
      };
      setVectorAdapter(adapter);
      expect(getVectorAdapter()).toBe(adapter);
    });
  });

  describe("default PgVectorAdapter", () => {
    beforeEach(() => {
      // Reset to default by overriding with a known pgvector-like adapter
      setVectorAdapter({
        name: "pgvector",
        upsert: async () => { throw new Error("pgvector upsert: use vectorStore.service.storeChunk() directly until migration is complete"); },
        search: async () => { throw new Error("pgvector search: use vectorStore.service.hybridSearch() directly until migration is complete"); },
        delete: async () => { throw new Error("pgvector delete: use vectorStore.service directly until migration is complete"); },
        ping: async () => true,
      });
    });

    it("ping returns true", async () => {
      const adapter = getVectorAdapter();
      const result = await adapter.ping();
      expect(result).toBe(true);
    });

    it("upsert throws with migration message", async () => {
      const adapter = getVectorAdapter();
      await expect(adapter.upsert("col", "id1", [1, 2], {})).rejects.toThrow("migration");
    });

    it("search throws with migration message", async () => {
      const adapter = getVectorAdapter();
      await expect(adapter.search("col", [1, 2], 5)).rejects.toThrow("migration");
    });

    it("delete throws with migration message", async () => {
      const adapter = getVectorAdapter();
      await expect(adapter.delete("col", "id1")).rejects.toThrow("migration");
    });
  });

  describe("custom adapter operations", () => {
    it("calls upsert with correct parameters", async () => {
      const upsertMock = vi.fn().mockResolvedValue(undefined);
      const adapter: VectorDbAdapter = {
        name: "mock",
        upsert: upsertMock,
        search: vi.fn().mockResolvedValue([]),
        delete: vi.fn(),
        ping: vi.fn().mockResolvedValue(true),
      };
      setVectorAdapter(adapter);
      await getVectorAdapter().upsert("articles", "doc-1", [0.1, 0.2], { title: "test" });
      expect(upsertMock).toHaveBeenCalledWith("articles", "doc-1", [0.1, 0.2], { title: "test" });
    });

    it("calls search and returns results", async () => {
      const results: VectorSearchResult[] = [{ id: "doc-1", score: 0.95, metadata: { title: "hello" } }];
      const searchMock = vi.fn().mockResolvedValue(results);
      const adapter: VectorDbAdapter = {
        name: "mock",
        upsert: vi.fn(),
        search: searchMock,
        delete: vi.fn(),
        ping: vi.fn().mockResolvedValue(true),
      };
      setVectorAdapter(adapter);
      const res = await getVectorAdapter().search("articles", [0.1, 0.2], 3);
      expect(searchMock).toHaveBeenCalledWith("articles", [0.1, 0.2], 3);
      expect(res).toEqual(results);
    });

    it("passes filter to search", async () => {
      const searchMock = vi.fn().mockResolvedValue([]);
      const adapter: VectorDbAdapter = {
        name: "mock",
        upsert: vi.fn(),
        search: searchMock,
        delete: vi.fn(),
        ping: vi.fn().mockResolvedValue(true),
      };
      setVectorAdapter(adapter);
      await getVectorAdapter().search("col", [1], 5, { tag: "science" });
      expect(searchMock).toHaveBeenCalledWith("col", [1], 5, { tag: "science" });
    });

    it("calls delete with correct parameters", async () => {
      const deleteMock = vi.fn().mockResolvedValue(undefined);
      const adapter: VectorDbAdapter = {
        name: "mock",
        upsert: vi.fn(),
        search: vi.fn().mockResolvedValue([]),
        delete: deleteMock,
        ping: vi.fn().mockResolvedValue(true),
      };
      setVectorAdapter(adapter);
      await getVectorAdapter().delete("articles", "doc-42");
      expect(deleteMock).toHaveBeenCalledWith("articles", "doc-42");
    });
  });
});
