import { describe, it, expect, vi, beforeEach } from "vitest";

// Must mock before importing module to control embed
vi.mock("../../src/services/embeddings.service.js", () => ({
  embed: vi.fn().mockResolvedValue([0.1, 0.2, 0.3]),
}));

import {
  getEmbeddingProvider,
  setEmbeddingProvider,
  type EmbeddingProvider,
} from "../../src/adapters/embeddingModel.adapter.js";
import { embed } from "../../src/services/embeddings.service.js";

const mockEmbed = vi.mocked(embed);

describe("embeddingModel.adapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("getEmbeddingProvider", () => {
    it("returns the default legacy provider by default", () => {
      const provider = getEmbeddingProvider();
      expect(provider).toBeDefined();
      expect(provider.name).toBe("legacy");
    });

    it("default provider has correct dimensions and model", () => {
      const provider = getEmbeddingProvider();
      expect(provider.dimensions).toBe(1536);
      expect(provider.model).toBe("auto-detected");
    });
  });

  describe("setEmbeddingProvider", () => {
    it("replaces the active provider", () => {
      const customProvider: EmbeddingProvider = {
        name: "custom",
        dimensions: 512,
        model: "custom-embed-v1",
        embed: vi.fn().mockResolvedValue([1, 2, 3]),
      };
      setEmbeddingProvider(customProvider);
      expect(getEmbeddingProvider().name).toBe("custom");
    });

    it("throws when provider is null", () => {
      expect(() => setEmbeddingProvider(null as unknown as EmbeddingProvider)).toThrow(
        "Invalid embedding provider"
      );
    });

    it("throws when provider does not implement embed()", () => {
      expect(() =>
        setEmbeddingProvider({ name: "bad", dimensions: 128, model: "x" } as unknown as EmbeddingProvider)
      ).toThrow("Invalid embedding provider: must implement embed()");
    });

    it("returns the new provider immediately via getEmbeddingProvider", () => {
      const p: EmbeddingProvider = {
        name: "quick",
        dimensions: 768,
        model: "quick-v1",
        embed: vi.fn().mockResolvedValue([9]),
      };
      setEmbeddingProvider(p);
      expect(getEmbeddingProvider()).toBe(p);
    });
  });

  describe("LegacyEmbeddingProvider.embed", () => {
    beforeEach(() => {
      // Restore legacy provider by resetting
      setEmbeddingProvider({
        name: "legacy",
        dimensions: 1536,
        model: "auto-detected",
        embed: async (text: string) => {
          const { embed: svcEmbed } = await import("../../src/services/embeddings.service.js");
          return svcEmbed(text);
        },
      });
    });

    it("delegates to embeddings.service.embed", async () => {
      mockEmbed.mockResolvedValue([0.5, 0.6]);
      const provider = getEmbeddingProvider();
      const result = await provider.embed("hello world");
      expect(result).toEqual([0.5, 0.6]);
    });
  });

  describe("custom provider with embedBatch", () => {
    it("calls embedBatch when provided", async () => {
      const batchMock = vi.fn().mockResolvedValue([[1, 2], [3, 4]]);
      const provider: EmbeddingProvider = {
        name: "batch-provider",
        dimensions: 2,
        model: "batch-v1",
        embed: vi.fn().mockResolvedValue([1]),
        embedBatch: batchMock,
      };
      setEmbeddingProvider(provider);
      const result = await getEmbeddingProvider().embedBatch!(["a", "b"]);
      expect(batchMock).toHaveBeenCalledWith(["a", "b"]);
      expect(result).toEqual([[1, 2], [3, 4]]);
    });

    it("embedBatch is optional — provider without it is still valid", () => {
      const provider: EmbeddingProvider = {
        name: "no-batch",
        dimensions: 128,
        model: "no-batch-v1",
        embed: vi.fn().mockResolvedValue([0]),
      };
      expect(() => setEmbeddingProvider(provider)).not.toThrow();
      expect(getEmbeddingProvider().embedBatch).toBeUndefined();
    });
  });
});
