import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../src/services/chunker.service.js", () => ({
  chunkText: vi.fn(),
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

import { chunkText } from "../../src/services/chunker.service.js";
import { storeChunk } from "../../src/services/vectorStore.service.js";
import { db } from "../../src/lib/drizzle.js";
import { kbDocuments } from "../../src/db/schema/uploads.js";
import { eq } from "drizzle-orm";
import logger from "../../src/lib/logger.js";
import { ingestDocument } from "../../src/services/ingestion.service.js";

const mockedChunkText = vi.mocked(chunkText);
const mockedStoreChunk = vi.mocked(storeChunk);
const mockedDb = vi.mocked(db);
const mockedLogger = vi.mocked(logger);
const mockedEq = vi.mocked(eq);

describe("ingestDocument", () => {
  const userId = 42;
  const kbId = "kb-001";
  const docId = "doc-abc";
  const filename = "report.pdf";

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    mockedStoreChunk.mockResolvedValue(undefined as any);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("should ingest a document with fewer than 10 chunks (single batch, no delay)", async () => {
    const chunks = ["c1", "c2", "c3"];
    mockedChunkText.mockReturnValue(chunks);

    const promise = ingestDocument(userId, kbId, docId, filename, "some text");
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result).toBe(3);
    expect(mockedChunkText).toHaveBeenCalledWith("some text");
    expect(mockedStoreChunk).toHaveBeenCalledTimes(3);
    expect(mockedStoreChunk).toHaveBeenCalledWith(userId, kbId, "c1", 0, filename);
    expect(mockedStoreChunk).toHaveBeenCalledWith(userId, kbId, "c2", 1, filename);
    expect(mockedStoreChunk).toHaveBeenCalledWith(userId, kbId, "c3", 2, filename);
  });

  it("should process chunks in batches of 10 with 200ms delay between batches", async () => {
    const chunks = Array.from({ length: 25 }, (_, i) => `chunk-${i}`);
    mockedChunkText.mockReturnValue(chunks);

    const storeCallOrder: number[] = [];
    mockedStoreChunk.mockImplementation(async (_u, _k, _c, idx) => {
      storeCallOrder.push(idx as number);
      return undefined as any;
    });

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
    expect(mockedStoreChunk).toHaveBeenCalledWith(userId, kbId, "chunk-0", 0, filename);
    expect(mockedStoreChunk).toHaveBeenCalledWith(userId, kbId, "chunk-10", 10, filename);
    expect(mockedStoreChunk).toHaveBeenCalledWith(userId, kbId, "chunk-20", 20, filename);
    expect(mockedStoreChunk).toHaveBeenCalledWith(userId, kbId, "chunk-24", 24, filename);
  });

  it("should not delay after the last batch", async () => {
    // Exactly 10 chunks = 1 batch, no delay needed
    const chunks = Array.from({ length: 10 }, (_, i) => `c${i}`);
    mockedChunkText.mockReturnValue(chunks);

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
    mockedChunkText.mockReturnValue([]);

    const promise = ingestDocument(userId, kbId, docId, filename, "");
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result).toBe(0);
    expect(mockedStoreChunk).not.toHaveBeenCalled();
  });

  it("should update kbDocuments with chunkCount, indexed flag, and indexedAt", async () => {
    const chunks = ["a", "b"];
    mockedChunkText.mockReturnValue(chunks);

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
    mockedChunkText.mockReturnValue(["x"]);

    const promise = ingestDocument(userId, kbId, docId, filename, "t");
    await vi.runAllTimersAsync();
    await promise;

    expect(mockedLogger.info).toHaveBeenCalledWith(
      { docId, filename, chunkCount: 1 },
      "Starting document ingestion"
    );
    expect(mockedLogger.info).toHaveBeenCalledWith(
      { docId, filename, chunkCount: 1 },
      "Document ingestion complete"
    );
  });

  it("should propagate errors from storeChunk", async () => {
    mockedChunkText.mockReturnValue(["a"]);
    mockedStoreChunk.mockRejectedValueOnce(new Error("vector store down"));

    const promise = ingestDocument(userId, kbId, docId, filename, "text");
    // Attach a no-op catch so the rejection is "handled" before vitest's runner sees it
    promise.catch(() => {});
    await vi.runAllTimersAsync();

    await expect(promise).rejects.toThrow("vector store down");
  });

  it("should propagate errors from the DB update", async () => {
    mockedChunkText.mockReturnValue(["a"]);

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
    const chunks = Array.from({ length: 20 }, (_, i) => `c${i}`);
    mockedChunkText.mockReturnValue(chunks);

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
    const chunks = Array.from({ length: 12 }, (_, i) => `chunk-${i}`);
    mockedChunkText.mockReturnValue(chunks);

    const promise = ingestDocument(userId, kbId, docId, filename, "text");
    await vi.runAllTimersAsync();
    await promise;

    // Second batch starts at index 10
    expect(mockedStoreChunk).toHaveBeenCalledWith(userId, kbId, "chunk-10", 10, filename);
    expect(mockedStoreChunk).toHaveBeenCalledWith(userId, kbId, "chunk-11", 11, filename);
  });
});
