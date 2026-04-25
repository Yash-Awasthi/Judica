import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock logger
vi.mock("../../src/lib/logger.js", () => ({
  default: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import {
  getArtifactStore,
  setArtifactStore,
  initArtifactStore,
} from "../../src/lib/artifactStorage.js";
import type { ArtifactStore } from "../../src/lib/artifactStorage.js";
import logger from "../../src/lib/logger.js";

describe("artifactStorage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset to default memory store before each test
    initArtifactStore();
  });

  // ---------- InMemoryArtifactStore ----------

  describe("InMemoryArtifactStore", () => {
    it("put and get artifact", async () => {
      const store = getArtifactStore();
      await store.put("stream-1", "art-1", "hello world");

      const result = await store.get("stream-1", "art-1");
      expect(result).toBeInstanceOf(Buffer);
      expect(result!.toString()).toBe("hello world");
    });

    it("put and get Buffer data", async () => {
      const store = getArtifactStore();
      const buf = Buffer.from([0x01, 0x02, 0x03]);
      await store.put("stream-1", "art-buf", buf);

      const result = await store.get("stream-1", "art-buf");
      expect(result).toEqual(buf);
    });

    it("get returns null for missing artifact", async () => {
      const store = getArtifactStore();
      const result = await store.get("nonexistent-stream", "nonexistent-art");
      expect(result).toBeNull();
    });

    it("get returns null for missing artifact in existing stream", async () => {
      const store = getArtifactStore();
      await store.put("stream-2", "art-1", "data");

      const result = await store.get("stream-2", "missing-art");
      expect(result).toBeNull();
    });

    it("deleteStream removes all artifacts", async () => {
      const store = getArtifactStore();
      await store.put("stream-3", "art-1", "data1");
      await store.put("stream-3", "art-2", "data2");
      await store.put("stream-3", "art-3", "data3");

      await store.deleteStream("stream-3");

      expect(await store.get("stream-3", "art-1")).toBeNull();
      expect(await store.get("stream-3", "art-2")).toBeNull();
      expect(await store.get("stream-3", "art-3")).toBeNull();
    });

    it("deleteStream is a no-op for nonexistent stream", async () => {
      const store = getArtifactStore();
      // Should not throw
      await store.deleteStream("nonexistent");
    });

    it("list returns artifact IDs for a stream", async () => {
      const store = getArtifactStore();
      await store.put("stream-4", "art-a", "a");
      await store.put("stream-4", "art-b", "b");
      await store.put("stream-4", "art-c", "c");

      const ids = await store.list("stream-4");
      expect(ids).toEqual(["art-a", "art-b", "art-c"]);
    });

    it("list returns empty array for nonexistent stream", async () => {
      const store = getArtifactStore();
      const ids = await store.list("nonexistent");
      expect(ids).toEqual([]);
    });

    it("evicts oldest stream when at MAX_STREAMS (500)", async () => {
      const store = getArtifactStore();

      // Fill up to MAX_STREAMS
      for (let i = 0; i < 500; i++) {
        await store.put(`stream-${i}`, "art", "data");
      }

      // Adding one more should evict the oldest (stream-0)
      await store.put("stream-new", "art", "data");

      expect(await store.get("stream-0", "art")).toBeNull();
      expect(await store.get("stream-new", "art")).not.toBeNull();
      // stream-1 should still exist
      expect(await store.get("stream-1", "art")).not.toBeNull();
    });

    it("evicts oldest artifact per stream when at MAX_ARTIFACTS_PER_STREAM (100)", async () => {
      const store = getArtifactStore();

      // Fill up to MAX_ARTIFACTS_PER_STREAM
      for (let i = 0; i < 100; i++) {
        await store.put("stream-full", `art-${i}`, `data-${i}`);
      }

      // Adding one more should evict the oldest (art-0)
      await store.put("stream-full", "art-new", "new-data");

      expect(await store.get("stream-full", "art-0")).toBeNull();
      expect(await store.get("stream-full", "art-new")).not.toBeNull();
      // art-1 should still exist
      expect(await store.get("stream-full", "art-1")).not.toBeNull();
    });

    it("overwrites existing artifact with same ID", async () => {
      const store = getArtifactStore();
      await store.put("stream-5", "art-1", "original");
      await store.put("stream-5", "art-1", "updated");

      const result = await store.get("stream-5", "art-1");
      expect(result!.toString()).toBe("updated");
    });

    it("has name 'memory'", () => {
      expect(getArtifactStore().name).toBe("memory");
    });
  });

  // ---------- getArtifactStore / setArtifactStore ----------

  describe("getArtifactStore", () => {
    it("returns default memory store", () => {
      const store = getArtifactStore();
      expect(store.name).toBe("memory");
    });
  });

  describe("setArtifactStore", () => {
    it("changes the active store", async () => {
      const customStore: ArtifactStore = {
        name: "custom",
        put: vi.fn(),
        get: vi.fn().mockResolvedValue(null),
        deleteStream: vi.fn(),
        list: vi.fn().mockResolvedValue([]),
      };

      setArtifactStore(customStore);
      expect(getArtifactStore()).toBe(customStore);
      expect(getArtifactStore().name).toBe("custom");
      expect(logger.info).toHaveBeenCalledWith(
        expect.objectContaining({ store: "custom" }),
        "Artifact store changed"
      );
    });
  });

  // ---------- initArtifactStore ----------

  describe("initArtifactStore", () => {
    it("defaults to memory when ARTIFACT_STORE is not set", () => {
      delete process.env.ARTIFACT_STORE;
      initArtifactStore();
      expect(getArtifactStore().name).toBe("memory");
      expect(logger.info).toHaveBeenCalledWith(
        expect.objectContaining({ store: "memory" }),
        "Artifact store initialized"
      );
    });

    it("creates memory store when ARTIFACT_STORE=memory", () => {
      process.env.ARTIFACT_STORE = "memory";
      initArtifactStore();
      expect(getArtifactStore().name).toBe("memory");
      delete process.env.ARTIFACT_STORE;
    });

    it("creates S3 store when ARTIFACT_STORE=s3", () => {
      process.env.ARTIFACT_STORE = "s3";
      initArtifactStore();
      expect(getArtifactStore().name).toBe("s3");
      delete process.env.ARTIFACT_STORE;
    });

    it("falls back to memory for unknown store type", () => {
      process.env.ARTIFACT_STORE = "gcs";
      initArtifactStore();
      expect(getArtifactStore().name).toBe("memory");
      delete process.env.ARTIFACT_STORE;
    });
  });

  // ---------- S3ArtifactStore ----------

  describe("S3ArtifactStore", () => {
    beforeEach(() => {
      process.env.ARTIFACT_STORE = "s3";
      initArtifactStore();
      delete process.env.ARTIFACT_STORE;
    });

    it("put throws 'not yet implemented'", async () => {
      const store = getArtifactStore();
      await expect(store.put("s", "a", "d")).rejects.toThrow("not yet implemented");
    });

    it("get throws 'not yet implemented'", async () => {
      const store = getArtifactStore();
      await expect(store.get("s", "a")).rejects.toThrow("not yet implemented");
    });

    it("deleteStream throws 'not yet implemented'", async () => {
      const store = getArtifactStore();
      await expect(store.deleteStream("s")).rejects.toThrow("not yet implemented");
    });

    it("list throws 'not yet implemented'", async () => {
      const store = getArtifactStore();
      await expect(store.list("s")).rejects.toThrow("not yet implemented");
    });

    it("has name 's3'", () => {
      expect(getArtifactStore().name).toBe("s3");
    });
  });
});
