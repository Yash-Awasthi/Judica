import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks ────────────────────────────────────────────────────────────────────

// db mock with chained select/insert/delete
const mockLimit = vi.fn();
const mockWhere = vi.fn(() => ({ limit: mockLimit }));
const mockFrom = vi.fn(() => ({ where: mockWhere }));
const mockSelect = vi.fn(() => ({ from: mockFrom }));

const mockOnConflictDoUpdate = vi.fn();
const mockValues = vi.fn(() => ({ onConflictDoUpdate: mockOnConflictDoUpdate }));
const mockInsert = vi.fn(() => ({ values: mockValues }));

const mockDeleteWhere = vi.fn();
const mockDelete = vi.fn(() => ({ where: mockDeleteWhere }));

vi.mock("../../src/lib/drizzle.js", () => ({
  db: {
    select: (...args: any[]) => mockSelect(...args),
    insert: (...args: any[]) => mockInsert(...args),
    delete: (...args: any[]) => mockDelete(...args),
  },
}));

vi.mock("../../src/db/schema/memory.js", () => ({
  memoryBackends: {
    userId: "userId",
    _table: "memoryBackends",
  },
}));

vi.mock("drizzle-orm", () => ({
  eq: (col: any, val: any) => ({ _tag: "eq", col, val }),
}));

const mockStoreChunk = vi.fn();
const mockSearchSimilar = vi.fn();
vi.mock("../../src/services/vectorStore.service.js", () => ({
  storeChunk: (...args: any[]) => mockStoreChunk(...args),
  searchSimilar: (...args: any[]) => mockSearchSimilar(...args),
}));

const mockEmbed = vi.fn();
vi.mock("../../src/services/embeddings.service.js", () => ({
  embed: (...args: any[]) => mockEmbed(...args),
}));

vi.mock("../../src/lib/logger.js", () => ({
  default: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const mockEncrypt = vi.fn((s: string) => `ENC:${s}`);
const mockDecrypt = vi.fn((s: string) => s.replace(/^ENC:/, ""));
vi.mock("../../src/lib/crypto.js", () => ({
  encrypt: (...args: any[]) => mockEncrypt(...args),
  decrypt: (...args: any[]) => mockDecrypt(...args),
}));

// Qdrant mock
const mockQdrantUpsert = vi.fn();
const mockQdrantSearch = vi.fn();
const MockQdrantClient = vi.fn(function (this: any) {
  this.upsert = mockQdrantUpsert;
  this.search = mockQdrantSearch;
});

vi.mock("@qdrant/js-client-rest", () => ({
  QdrantClient: MockQdrantClient,
}));

// Zep mock
const mockZepMemoryAdd = vi.fn();
const mockZepInit = vi.fn(() => ({
  memory: { addMemory: mockZepMemoryAdd },
}));

vi.mock("@getzep/zep-js", () => ({
  ZepClient: { init: (...args: any[]) => mockZepInit(...args) },
}));

// Stub crypto.randomUUID globally
const FAKE_UUID = "00000000-0000-0000-0000-000000000001";
vi.stubGlobal("crypto", { randomUUID: () => FAKE_UUID });

// ── Import SUT after mocks ──────────────────────────────────────────────────

import {
  getBackend,
  setBackend,
  removeBackend,
  routedStoreChunk,
  routedSearch,
  encryptConfig,
  decryptConfig,
} from "../../src/services/memoryRouter.service.js";

// ── Helpers ─────────────────────────────────────────────────────────────────

const USER_ID = 42;
const FAKE_VECTOR = [0.1, 0.2, 0.3];

function dbReturnsBackend(
  backend: { type: string; config: string; active: boolean } | null
) {
  mockLimit.mockResolvedValue(backend ? [backend] : []);
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe("memoryRouter.service", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Re-wire the db chain after clearAllMocks resets implementations
    mockSelect.mockReturnValue({ from: mockFrom });
    mockFrom.mockReturnValue({ where: mockWhere });
    mockWhere.mockReturnValue({ limit: mockLimit });
    mockInsert.mockReturnValue({ values: mockValues });
    mockValues.mockReturnValue({ onConflictDoUpdate: mockOnConflictDoUpdate });
    mockDelete.mockReturnValue({ where: mockDeleteWhere });

    mockEmbed.mockResolvedValue(FAKE_VECTOR);
  });

  // ── encryptConfig / decryptConfig ──────────────────────────────────────

  describe("encryptConfig", () => {
    it("delegates to lib/crypto encrypt", () => {
      const result = encryptConfig("hello");
      expect(mockEncrypt).toHaveBeenCalledWith("hello");
      expect(result).toBe("ENC:hello");
    });
  });

  describe("decryptConfig", () => {
    it("delegates to lib/crypto decrypt", () => {
      const result = decryptConfig("ENC:hello");
      expect(mockDecrypt).toHaveBeenCalledWith("ENC:hello");
      expect(result).toBe("hello");
    });
  });

  // ── getBackend ─────────────────────────────────────────────────────────

  describe("getBackend", () => {
    it("returns null when no backend row exists", async () => {
      dbReturnsBackend(null);
      const result = await getBackend(USER_ID);
      expect(result).toBeNull();
    });

    it("returns null when backend is inactive", async () => {
      dbReturnsBackend({ type: "qdrant", config: 'ENC:{"url":"x"}', active: false });
      const result = await getBackend(USER_ID);
      expect(result).toBeNull();
    });

    it("decrypts and parses active backend config", async () => {
      const configPlain = JSON.stringify({ url: "http://qdrant:6333", apiKey: "key123" });
      dbReturnsBackend({ type: "qdrant", config: `ENC:${configPlain}`, active: true });

      const result = await getBackend(USER_ID);

      expect(mockDecrypt).toHaveBeenCalled();
      expect(result).toEqual({
        type: "qdrant",
        url: "http://qdrant:6333",
        apiKey: "key123",
      });
    });

    it("returns null when decryption/parsing fails", async () => {
      dbReturnsBackend({ type: "qdrant", config: "CORRUPT", active: true });
      mockDecrypt.mockImplementationOnce(() => {
        throw new Error("bad cipher");
      });

      const result = await getBackend(USER_ID);
      expect(result).toBeNull();
    });

    it("returns null when JSON.parse fails on decrypted text", async () => {
      dbReturnsBackend({ type: "qdrant", config: "ENC:not-json", active: true });

      const result = await getBackend(USER_ID);
      expect(result).toBeNull();
    });
  });

  // ── setBackend ─────────────────────────────────────────────────────────

  describe("setBackend", () => {
    it("encrypts config and upserts into db", async () => {
      const config = { url: "http://q:6333", apiKey: "abc" };
      await setBackend(USER_ID, "qdrant", config);

      expect(mockEncrypt).toHaveBeenCalledWith(JSON.stringify(config));
      expect(mockInsert).toHaveBeenCalled();
      expect(mockValues).toHaveBeenCalledWith({
        id: FAKE_UUID,
        userId: USER_ID,
        type: "qdrant",
        config: `ENC:${JSON.stringify(config)}`,
        active: true,
      });
      expect(mockOnConflictDoUpdate).toHaveBeenCalledWith({
        target: "userId",
        set: { type: "qdrant", config: `ENC:${JSON.stringify(config)}`, active: true },
      });
    });
  });

  // ── removeBackend ──────────────────────────────────────────────────────

  describe("removeBackend", () => {
    it("deletes the backend row for the user", async () => {
      await removeBackend(USER_ID);

      expect(mockDelete).toHaveBeenCalled();
      expect(mockDeleteWhere).toHaveBeenCalledWith({
        _tag: "eq",
        col: "userId",
        val: USER_ID,
      });
    });
  });

  // ── routedStoreChunk ───────────────────────────────────────────────────

  describe("routedStoreChunk", () => {
    const content = "some chunk text";
    const kbId = "kb-1";
    const chunkIndex = 0;
    const sourceName = "doc.pdf";
    const sourceUrl = "https://example.com/doc.pdf";

    it("falls back to local storeChunk when no backend configured", async () => {
      dbReturnsBackend(null);
      mockStoreChunk.mockResolvedValue("local-id-1");

      const result = await routedStoreChunk(USER_ID, kbId, content, chunkIndex, sourceName, sourceUrl);

      expect(mockStoreChunk).toHaveBeenCalledWith(USER_ID, kbId, content, chunkIndex, sourceName, sourceUrl);
      expect(result).toBe("local-id-1");
    });

    it("uses local storeChunk when backend type is 'local'", async () => {
      dbReturnsBackend({
        type: "local",
        config: `ENC:${JSON.stringify({})}`,
        active: true,
      });
      mockStoreChunk.mockResolvedValue("local-id-2");

      const result = await routedStoreChunk(USER_ID, kbId, content, chunkIndex, sourceName, sourceUrl);
      expect(mockStoreChunk).toHaveBeenCalled();
      expect(result).toBe("local-id-2");
    });

    it("passes null kbId to storeChunk when kbId is undefined", async () => {
      dbReturnsBackend(null);
      mockStoreChunk.mockResolvedValue("local-id-3");

      await routedStoreChunk(USER_ID, undefined, content, chunkIndex);
      expect(mockStoreChunk).toHaveBeenCalledWith(USER_ID, null, content, chunkIndex, undefined, undefined);
    });

    // Qdrant

    it("stores in Qdrant when backend type is 'qdrant'", async () => {
      const configPlain = JSON.stringify({ url: "http://q:6333", apiKey: "key1", collectionName: "my_col" });
      dbReturnsBackend({ type: "qdrant", config: `ENC:${configPlain}`, active: true });

      const result = await routedStoreChunk(USER_ID, kbId, content, chunkIndex, sourceName, sourceUrl);

      expect(MockQdrantClient).toHaveBeenCalledWith({ url: "http://q:6333", apiKey: "key1" });
      expect(mockEmbed).toHaveBeenCalledWith(content);
      expect(mockQdrantUpsert).toHaveBeenCalledWith("my_col", {
        points: [
          {
            id: FAKE_UUID,
            vector: FAKE_VECTOR,
            payload: { content, userId: USER_ID, kbId, sourceName, sourceUrl, chunkIndex },
          },
        ],
      });
      expect(result).toBe(FAKE_UUID);
    });

    it("uses default collection name when not configured for qdrant", async () => {
      const configPlain = JSON.stringify({ url: "http://q:6333" });
      dbReturnsBackend({ type: "qdrant", config: `ENC:${configPlain}`, active: true });

      await routedStoreChunk(USER_ID, kbId, content, chunkIndex);

      expect(mockQdrantUpsert).toHaveBeenCalledWith(
        `user_${USER_ID}`,
        expect.anything()
      );
    });

    it("uses default Qdrant URL when not configured", async () => {
      const configPlain = JSON.stringify({});
      dbReturnsBackend({ type: "qdrant", config: `ENC:${configPlain}`, active: true });

      await routedStoreChunk(USER_ID, kbId, content, chunkIndex);

      expect(MockQdrantClient).toHaveBeenCalledWith({ url: "http://localhost:6333", apiKey: undefined });
    });

    it("falls back to local on Qdrant store failure", async () => {
      const configPlain = JSON.stringify({ url: "http://q:6333" });
      dbReturnsBackend({ type: "qdrant", config: `ENC:${configPlain}`, active: true });
      mockQdrantUpsert.mockRejectedValue(new Error("connection refused"));
      mockStoreChunk.mockResolvedValue("fallback-id");

      const result = await routedStoreChunk(USER_ID, kbId, content, chunkIndex, sourceName, sourceUrl);

      expect(mockStoreChunk).toHaveBeenCalledWith(USER_ID, kbId, content, chunkIndex, sourceName, sourceUrl);
      expect(result).toBe("fallback-id");
    });

    // Zep

    it("stores in Zep when backend type is 'getzep'", async () => {
      const configPlain = JSON.stringify({ url: "https://zep.example.com", apiKey: "zkey", sessionId: "sess-1" });
      dbReturnsBackend({ type: "getzep", config: `ENC:${configPlain}`, active: true });

      const result = await routedStoreChunk(USER_ID, kbId, content, chunkIndex, sourceName, sourceUrl);

      expect(mockZepInit).toHaveBeenCalledWith("https://zep.example.com", "zkey");
      expect(mockZepMemoryAdd).toHaveBeenCalledWith("sess-1", [
        expect.objectContaining({ role: "system", content }),
      ]);
      expect(result).toMatch(/^zep_sess-1_\d+$/);
    });

    it("uses default Zep session when not configured", async () => {
      const configPlain = JSON.stringify({ url: "https://zep.example.com", apiKey: "zkey" });
      dbReturnsBackend({ type: "getzep", config: `ENC:${configPlain}`, active: true });

      const result = await routedStoreChunk(USER_ID, kbId, content, chunkIndex);

      expect(mockZepMemoryAdd).toHaveBeenCalledWith(
        `user_${USER_ID}`,
        expect.anything()
      );
      expect(result).toMatch(new RegExp(`^zep_user_${USER_ID}_\\d+$`));
    });

    it("falls back to local on Zep store failure", async () => {
      const configPlain = JSON.stringify({ url: "https://zep.example.com", apiKey: "zkey" });
      dbReturnsBackend({ type: "getzep", config: `ENC:${configPlain}`, active: true });
      mockZepMemoryAdd.mockRejectedValue(new Error("zep timeout"));
      mockStoreChunk.mockResolvedValue("fallback-id-zep");

      const result = await routedStoreChunk(USER_ID, kbId, content, chunkIndex, sourceName, sourceUrl);

      expect(mockStoreChunk).toHaveBeenCalled();
      expect(result).toBe("fallback-id-zep");
    });

    // Unknown / google_drive fallback

    it("falls back to local for unsupported backend types like google_drive", async () => {
      const configPlain = JSON.stringify({});
      dbReturnsBackend({ type: "google_drive", config: `ENC:${configPlain}`, active: true });
      mockStoreChunk.mockResolvedValue("fallback-gd");

      const result = await routedStoreChunk(USER_ID, kbId, content, chunkIndex);

      expect(mockStoreChunk).toHaveBeenCalled();
      expect(result).toBe("fallback-gd");
    });
  });

  // ── routedSearch ───────────────────────────────────────────────────────

  describe("routedSearch", () => {
    const query = "find something";
    const kbId = "kb-1";
    const limit = 3;

    const localResults = [
      { content: "result1", score: 0.95, sourceName: "doc.pdf" },
      { content: "result2", score: 0.85, sourceName: null },
    ];

    it("searches locally when no backend configured", async () => {
      dbReturnsBackend(null);
      mockSearchSimilar.mockResolvedValue(localResults);

      const results = await routedSearch(USER_ID, query, kbId, limit);

      expect(mockSearchSimilar).toHaveBeenCalledWith(USER_ID, query, kbId, limit);
      expect(results).toEqual([
        { content: "result1", score: 0.95, source: "doc.pdf" },
        { content: "result2", score: 0.85, source: undefined },
      ]);
    });

    it("searches locally when backend type is 'local'", async () => {
      dbReturnsBackend({
        type: "local",
        config: `ENC:${JSON.stringify({})}`,
        active: true,
      });
      mockSearchSimilar.mockResolvedValue(localResults);

      const results = await routedSearch(USER_ID, query, kbId, limit);
      expect(mockSearchSimilar).toHaveBeenCalled();
      expect(results).toHaveLength(2);
    });

    it("defaults score to 0 when similarity is missing from local results", async () => {
      dbReturnsBackend(null);
      mockSearchSimilar.mockResolvedValue([{ content: "x", sourceName: "y" }]);

      const results = await routedSearch(USER_ID, query);
      expect(results[0].score).toBe(0);
    });

    it("uses default limit of 5 when not specified", async () => {
      dbReturnsBackend(null);
      mockSearchSimilar.mockResolvedValue([]);

      await routedSearch(USER_ID, query);
      expect(mockSearchSimilar).toHaveBeenCalledWith(USER_ID, query, undefined, 5);
    });

    // Qdrant search

    it("searches Qdrant when backend type is 'qdrant'", async () => {
      const configPlain = JSON.stringify({ url: "http://q:6333", apiKey: "k", collectionName: "my_col" });
      dbReturnsBackend({ type: "qdrant", config: `ENC:${configPlain}`, active: true });

      const qdrantResults = [
        { score: 0.92, payload: { content: "qresult1", sourceName: "src1" } },
        { score: 0.80, payload: { content: "qresult2" } },
      ];
      mockQdrantSearch.mockResolvedValue(qdrantResults);

      const results = await routedSearch(USER_ID, query, kbId, limit);

      expect(mockEmbed).toHaveBeenCalledWith(query);
      expect(mockQdrantSearch).toHaveBeenCalledWith("my_col", {
        vector: FAKE_VECTOR,
        limit,
        filter: { must: [{ key: "kbId", match: { value: kbId } }] },
      });
      expect(results).toEqual([
        { content: "qresult1", score: 0.92, source: "src1" },
        { content: "qresult2", score: 0.80, source: undefined },
      ]);
    });

    it("searches Qdrant without filter when kbId is not provided", async () => {
      const configPlain = JSON.stringify({ url: "http://q:6333" });
      dbReturnsBackend({ type: "qdrant", config: `ENC:${configPlain}`, active: true });
      mockQdrantSearch.mockResolvedValue([]);

      await routedSearch(USER_ID, query, undefined, limit);

      expect(mockQdrantSearch).toHaveBeenCalledWith(`user_${USER_ID}`, {
        vector: FAKE_VECTOR,
        limit,
        filter: undefined,
      });
    });

    it("falls back to local on Qdrant search failure", async () => {
      const configPlain = JSON.stringify({ url: "http://q:6333" });
      dbReturnsBackend({ type: "qdrant", config: `ENC:${configPlain}`, active: true });
      mockQdrantSearch.mockRejectedValue(new Error("network error"));
      mockSearchSimilar.mockResolvedValue(localResults);

      const results = await routedSearch(USER_ID, query, kbId, limit);

      expect(mockSearchSimilar).toHaveBeenCalledWith(USER_ID, query, kbId, limit);
      expect(results).toHaveLength(2);
    });

    it("handles Qdrant results with missing payload gracefully", async () => {
      const configPlain = JSON.stringify({ url: "http://q:6333" });
      dbReturnsBackend({ type: "qdrant", config: `ENC:${configPlain}`, active: true });
      mockQdrantSearch.mockResolvedValue([{ score: 0.5, payload: null }]);

      const results = await routedSearch(USER_ID, query);

      expect(results).toEqual([{ content: "", score: 0.5, source: undefined }]);
    });

    // Unsupported backend search fallback

    it("falls back to local for unsupported backend types on search", async () => {
      const configPlain = JSON.stringify({});
      dbReturnsBackend({ type: "google_drive", config: `ENC:${configPlain}`, active: true });
      mockSearchSimilar.mockResolvedValue(localResults);

      const results = await routedSearch(USER_ID, query, kbId, limit);

      expect(mockSearchSimilar).toHaveBeenCalled();
      expect(results).toHaveLength(2);
    });
  });
});
