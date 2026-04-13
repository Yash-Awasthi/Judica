import { describe, it, expect, vi, beforeEach } from "vitest";
import { 
  resolveProvider, 
  loadProviderRegistry, 
  getProviders, 
  getProviderByName,
  getProvidersByType,
  getFallbackProvider,
  isProviderLimitReached,
  getProviderDefaults
} from "../../src/lib/providerRegistry.js";
import { loadProviderConfig } from "../../src/config/providerConfig.js";

vi.mock("../../src/config/providerConfig.js", () => ({
  loadProviderConfig: vi.fn()
}));

vi.mock("../../src/lib/logger.js", () => ({
  default: { info: vi.fn(), warn: vi.fn(), debug: vi.fn() }
}));

// Mock dynamic import of fs/promises
vi.mock("fs/promises", () => ({
  readFile: vi.fn()
}));

describe("Provider Registry", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    // No easy way to clear cachedConfig/cachedRegistry without exporting them,
    // so tests should be aware of this or we could use a hack.
    // For now, we'll try to test around it.
  });

  describe("resolveProvider", () => {
    it("should resolve provider type based on model patterns", async () => {
      vi.mocked(loadProviderConfig).mockResolvedValue({
        providers: [
          { pattern: "gpt-4", type: "openai-compat", defaultMaxTokens: 2000, enabled: true },
          { pattern: "claude", type: "anthropic", defaultMaxTokens: 4000, enabled: true }
        ]
      } as any);

      const result = await resolveProvider({ name: "p", type: "openai-compat", apiKey: "k", model: "gpt-4-turbo" });
      expect(result.type).toBe("openai-compat");
      expect(result.maxTokens).toBe(2000);

      const result2 = await resolveProvider({ name: "p", type: "openai-compat", apiKey: "k", model: "claude-3-sonnet" });
      expect(result2.type).toBe("anthropic");
      expect(result2.maxTokens).toBe(4000);
    });
  });

  describe("loadProviderRegistry", () => {
    it("should use DEFAULT_REGISTRY if file reading fails", async () => {
      const fs = await import("fs/promises");
      vi.mocked(fs.readFile).mockRejectedValue(new Error("File not found"));
      
      const registry = await loadProviderRegistry();
      expect(registry.providers).toBeDefined();
      expect(registry.providers[0].name).toBe("openai");
    });
  });

  describe("getProviders helper functions", () => {
    it("should return enabled providers", async () => {
      // Assuming DEFAULT_REGISTRY is loaded from previous test or fallback
      const providers = await getProviders();
      expect(providers.every(p => p.enabled)).toBe(true);
    });

    it("should get provider by name", async () => {
      const p = await getProviderByName("openai");
      expect(p?.name).toBe("openai");
    });

    it("should get providers by type", async () => {
      const apiProviders = await getProvidersByType("api");
      expect(apiProviders.every(p => p.type === "api")).toBe(true);
    });

    it("should get fallback provider for type", async () => {
      const fallback = await getFallbackProvider("api");
      expect(fallback).toBe("openai");
    });
  });

  describe("isProviderLimitReached", () => {
    it("should check limits correctly", async () => {
      // Registry has maxApiProviders: 5
      const reached = await isProviderLimitReached("api");
      expect(reached).toBe(false);
    });
  });

  describe("getProviderDefaults", () => {
    it("should provide default timeout and concurrency", () => {
      const p = { name: "test", type: "api", baseUrl: "b", models: [], priority: 1, enabled: true } as any;
      const defaults = getProviderDefaults(p);
      expect(defaults.timeoutMs).toBe(60000);
      expect(defaults.maxConcurrency).toBe(3);
    });
  });
});
