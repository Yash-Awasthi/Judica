import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../src/services/chunker.service.js", () => ({
  chunkText: vi.fn(),
  chunkHierarchical: vi.fn(),
}));

vi.mock("../../src/services/vectorStore.service.js", () => ({
  storeChunk: vi.fn(),
}));

vi.mock("../../src/lib/drizzle.js", () => {
  const whereStub = vi.fn().mockResolvedValue(undefined);
  const setStub = vi.fn(() => ({ where: whereStub }));
  const updateStub = vi.fn(() => ({ set: setStub }));
  return {
    db: { update: updateStub },
    __whereStub: whereStub,
    __setStub: setStub,
  };
});

vi.mock("../../src/db/schema/uploads.js", () => ({
  kbDocuments: { id: "kbDocuments.id" },
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((...args: unknown[]) => ({ op: "eq", args })),
}));

vi.mock("../../src/lib/logger.js", () => ({
  default: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

import { chunkHierarchical } from "../../src/services/chunker.service.js";
import { storeChunk } from "../../src/services/vectorStore.service.js";
import { db } from "../../src/lib/drizzle.js";
import { kbDocuments } from "../../src/db/schema/uploads.js";
import { eq } from "drizzle-orm";
import logger from "../../src/lib/logger.js";
import { ingestDocument } from "../../src/services/ingestion.service.js";

const mockedChunkHierarchical = vi.mocked(chunkHierarchical);
const mockedStoreChunk = vi.mocked(storeChunk);
const mockedDb = vi.mocked(db);
const mockedLogger = vi.mocked(logger);
const mockedEq = vi.mocked(eq);

/** Helper: create a standalone parent chunk (no hierarchy needed) */
function parentChunk(content: string) {
  return { content, parentContent: null, level: "parent" as const };
}

/** Helper: create a child chunk with parent reference */
function childChunk(content: string, parentContent: string) {
  return { content, parentContent, level: "child" as const };
}

describe("ingestDocument", () => {
  const userId = 42;
  const kbId = "kb-001";
  const docId = "doc-abc";
  const filename = "report.pdf";

  let parentIdCounter: number;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    parentIdCounter = 0;
    mockedStoreChunk.mockImplementation(async () => {
      return `uuid-${parentIdCounter++}`;
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("should ingest a document with standalone parent chunks (no hierarchy)", async () => {
    const chunks = [parentChunk("c1"), parentChunk("c2"), parentChunk("c3")];
    mockedChunkHierarchical.mockReturnValue(chunks);

    const promise = ingestDocument(userId, kbId, docId, filename, "some text");
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result).toBe(3);
    expect(mockedChunkHierarchical).toHaveBeenCalledWith("some text");
    expect(mockedStoreChunk).toHaveBeenCalledTimes(3);
    expect(mockedStoreChunk).toHaveBeenCalledWith(userId, kbId, "c1", 0, filename, undefined, undefined, undefined, []);
    expect(mockedStoreChunk).toHaveBeenCalledWith(userId, kbId, "c2", 1, filename, undefined, undefined, undefined, []);
    expect(mockedStoreChunk).toHaveBeenCalledWith(userId, kbId, "c3", 2, filename, undefined, undefined, undefined, []);
  });

  it("should store parent chunk first, then child with parentChunkId", async () => {
    const pContent = "parent text that is long enough";
    const chunks = [
      childChunk("child-1", pContent),
      childChunk("child-2", pContent),
    ];
    mockedChunkHierarchical.mockReturnValue(chunks);

    // First storeChunk call (parent) returns "parent-uuid"
    // Subsequent calls (children) return sequential uuids
    mockedStoreChunk
      .mockResolvedValueOnce("parent-uuid")   // parent store
      .mockResolvedValueOnce("child-1-uuid")   // child-1 store
      .mockResolvedValueOnce("child-2-uuid");  // child-2 store

    const promise = ingestDocument(userId, kbId, docId, filename, "text");
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result).toBe(2);

    // Parent stored first (no parentChunkId)
    expect(mockedStoreChunk).toHaveBeenCalledWith(
      userId, kbId, pContent, 0, filename, undefined, undefined, undefined, [],
    );

    // Children stored with parent reference
    expect(mockedStoreChunk).toHaveBeenCalledWith(
      userId, kbId, "child-1", 0, filename, undefined, "parent-uuid", undefined, [],
    );
    expect(mockedStoreChunk).toHaveBeenCalledWith(
      userId, kbId, "child-2", 1, filename, undefined, "parent-uuid", undefined, [],
    );
  });

  it("should deduplicate parent storage for children sharing the same parent", async () => {
    const pContent = "shared parent content";
    const chunks = [
      childChunk("child-a", pContent),
      childChunk("child-b", pContent),
      childChunk("child-c", pContent),
    ];
    mockedChunkHierarchical.mockReturnValue(chunks);

    mockedStoreChunk
      .mockResolvedValueOnce("parent-id")  // parent stored once
      .mockResolvedValue("child-id");       // children

    const promise = ingestDocument(userId, kbId, docId, filename, "text");
    await vi.runAllTimersAsync();
    await promise;

    // 1 parent store + 3 child stores = 4 total calls
    expect(mockedStoreChunk).toHaveBeenCalledTimes(4);

    // Parent content stored exactly once
    const parentCalls = mockedStoreChunk.mock.calls.filter(
      (args) => args[2] === pContent
    );
    expect(parentCalls).toHaveLength(1);
  });

  it("should process chunks in batches of 10 with 200ms delay between batches", async () => {
    const chunks = Array.from({ length: 25 }, (_, i) => parentChunk(`chunk-${i}`));
    mockedChunkHierarchical.mockReturnValue(chunks);

    const promise = ingestDocument(userId, kbId, docId, filename, "long text");

    // First batch (0-9) runs immediately
    await vi.advanceTimersByTimeAsync(0);

    // After first batch, a 200ms delay fires before second batch
    await vi.advanceTimersByTimeAsync(200);

    // After second batch, another 200ms delay before third batch
    await vi.advanceTimersByTimeAsync(200);

    const result = await promise;

    expect(result).toBe(25);
    expect(mockedStoreChunk).toHaveBeenCalledTimes(25);

    // Verify the global indices passed to storeChunk are correct
    expect(mockedStoreChunk).toHaveBeenCalledWith(userId, kbId, "chunk-0", 0, filename, undefined, undefined, undefined, []);
    expect(mockedStoreChunk).toHaveBeenCalledWith(userId, kbId, "chunk-10", 10, filename, undefined, undefined, undefined, []);
    expect(mockedStoreChunk).toHaveBeenCalledWith(userId, kbId, "chunk-20", 20, filename, undefined, undefined, undefined, []);
    expect(mockedStoreChunk).toHaveBeenCalledWith(userId, kbId, "chunk-24", 24, filename, undefined, undefined, undefined, []);
  });

  it("should not delay after the last batch", async () => {
    // Exactly 10 chunks = 1 batch, no delay needed
    const chunks = Array.from({ length: 10 }, (_, i) => parentChunk(`c${i}`));
    mockedChunkHierarchical.mockReturnValue(chunks);

    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");

    const promise = ingestDocument(userId, kbId, docId, filename, "text");
    await vi.runAllTimersAsync();
    await promise;

    // setTimeout is called for delay(); with exactly 10 chunks there should be no delay call
    const delayCalls = setTimeoutSpy.mock.calls.filter(
      ([, ms]) => ms === 200
    );
    expect(delayCalls).toHaveLength(0);

    setTimeoutSpy.mockRestore();
  });

  it("should handle empty text (zero chunks)", async () => {
    mockedChunkHierarchical.mockReturnValue([]);

    const promise = ingestDocument(userId, kbId, docId, filename, "");
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result).toBe(0);
    expect(mockedStoreChunk).not.toHaveBeenCalled();
  });

  it("should update kbDocuments with chunkCount, indexed flag, and indexedAt", async () => {
    const chunks = [parentChunk("a"), parentChunk("b")];
    mockedChunkHierarchical.mockReturnValue(chunks);

    const fakeDate = new Date("2026-04-14T12:00:00Z");
    vi.setSystemTime(fakeDate);

    const promise = ingestDocument(userId, kbId, docId, filename, "text");
    await vi.runAllTimersAsync();
    await promise;

    expect(mockedDb.update).toHaveBeenCalledWith(kbDocuments);

    const setStub = mockedDb.update(kbDocuments).set;
    expect(setStub).toHaveBeenCalledWith({
      chunkCount: 2,
      indexed: true,
      indexedAt: fakeDate,
    });

    expect(mockedEq).toHaveBeenCalledWith(kbDocuments.id, docId);
  });

  it("should log start and completion messages", async () => {
    mockedChunkHierarchical.mockReturnValue([parentChunk("x")]);

    const promise = ingestDocument(userId, kbId, docId, filename, "t");
    await vi.runAllTimersAsync();
    await promise;

    expect(mockedLogger.info).toHaveBeenCalledWith(
      { docId, filename, chunkCount: 1 },
      "Starting document ingestion (hierarchical)"
    );
    expect(mockedLogger.info).toHaveBeenCalledWith(
      { docId, filename, chunkCount: 1 },
      "Document ingestion complete (hierarchical)"
    );
  });

  it("should catch and skip errors from storeChunk without throwing", async () => {
    mockedChunkHierarchical.mockReturnValue([parentChunk("a")]);
    mockedStoreChunk.mockRejectedValueOnce(new Error("vector store down"));

    const promise = ingestDocument(userId, kbId, docId, filename, "text");
    await vi.runAllTimersAsync();

    // Error is caught and logged, returns 0 successful chunks
    const result = await promise;
    expect(result).toBe(0);
    expect(mockedLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ docId, chunkIndex: 0 }),
      "Failed to store chunk — skipping"
    );
  });

  it("should propagate errors from the DB update", async () => {
    mockedChunkHierarchical.mockReturnValue([parentChunk("a")]);

    const originalUpdate = mockedDb.update;
    const whereStub = vi.fn().mockRejectedValueOnce(new Error("db write failed"));
    const setStub = vi.fn(() => ({ where: whereStub }));
    mockedDb.update = vi.fn(() => ({ set: setStub })) as any;

    const promise = ingestDocument(userId, kbId, docId, filename, "text");
    promise.catch(() => {});
    await vi.runAllTimersAsync();

    await expect(promise).rejects.toThrow("db write failed");

    // Restore original mock so subsequent tests are not affected
    mockedDb.update = originalUpdate;
  });

  it("should handle exactly 20 chunks (2 full batches, one delay)", async () => {
    const chunks = Array.from({ length: 20 }, (_, i) => parentChunk(`c${i}`));
    mockedChunkHierarchical.mockReturnValue(chunks);

    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");

    const promise = ingestDocument(userId, kbId, docId, filename, "text");
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result).toBe(20);
    expect(mockedStoreChunk).toHaveBeenCalledTimes(20);

    const delayCalls = setTimeoutSpy.mock.calls.filter(
      ([, ms]) => ms === 200
    );
    expect(delayCalls).toHaveLength(1);

    setTimeoutSpy.mockRestore();
  });

  it("should pass correct global index to storeChunk across batches", async () => {
    const chunks = Array.from({ length: 12 }, (_, i) => parentChunk(`chunk-${i}`));
    mockedChunkHierarchical.mockReturnValue(chunks);

    const promise = ingestDocument(userId, kbId, docId, filename, "text");
    await vi.runAllTimersAsync();
    await promise;

    // Second batch starts at index 10
    expect(mockedStoreChunk).toHaveBeenCalledWith(userId, kbId, "chunk-10", 10, filename, undefined, undefined, undefined, []);
    expect(mockedStoreChunk).toHaveBeenCalledWith(userId, kbId, "chunk-11", 11, filename, undefined, undefined, undefined, []);
  });

  it("should handle a mix of parent and child chunks", async () => {
    const pContent = "big parent content here";
    const chunks = [
      parentChunk("standalone"),
      childChunk("child-1", pContent),
      childChunk("child-2", pContent),
    ];
    mockedChunkHierarchical.mockReturnValue(chunks);

    mockedStoreChunk
      .mockResolvedValueOnce("standalone-id")  // standalone parent
      .mockResolvedValueOnce("parent-id")       // parent for children
      .mockResolvedValueOnce("child-1-id")      // child-1
      .mockResolvedValueOnce("child-2-id");     // child-2

    const promise = ingestDocument(userId, kbId, docId, filename, "text");
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result).toBe(3);
    // 1 standalone + 1 parent + 2 children = 4 storeChunk calls
    expect(mockedStoreChunk).toHaveBeenCalledTimes(4);

    // Standalone stored without parentChunkId
    expect(mockedStoreChunk).toHaveBeenCalledWith(userId, kbId, "standalone", 0, filename, undefined, undefined, undefined, []);

    // Children stored with parent reference
    expect(mockedStoreChunk).toHaveBeenCalledWith(
      userId, kbId, "child-1", 1, filename, undefined, "parent-id", undefined, [],
    );
    expect(mockedStoreChunk).toHaveBeenCalledWith(
      userId, kbId, "child-2", 2, filename, undefined, "parent-id", undefined, [],
    );
  });
});
