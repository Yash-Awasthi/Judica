import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Static mocks (hoisted before imports) ────────────────────────────────────

vi.mock("../../src/config/providerConfig.js", () => ({
  loadProviderConfig: vi.fn(),
}));

vi.mock("../../src/lib/logger.js", () => ({
  default: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));

vi.mock("fs/promises", () => ({
  default: { readFile: vi.fn() },
  readFile: vi.fn(),
}));

// ── Imports after mocks ───────────────────────────────────────────────────────

import {
  resolveProvider,
  loadProviderRegistry,
  getProviders,
  getProviderByName,
  getProvidersByType,
  getFallbackProvider,
  isProviderLimitReached,
  getProviderDefaults,
  invalidateRegistryCache,
  getDerivedRegistry,
} from "../../src/lib/providerRegistry.js";
import { loadProviderConfig } from "../../src/config/providerConfig.js";
import logger from "../../src/lib/logger.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

const VALID_PROVIDER = {
  name: "test-prov",
  type: "api" as const,
  baseUrl: "https://api.test.com",
  models: ["model-a"],
  priority: 80,
  enabled: true,
};

const VALID_REGISTRY = {
  providers: [VALID_PROVIDER],
  fallbacks: { api: "test-prov", local: "ollama-local", rpa: "chatgpt-rpa" },
  limits: { maxRpaProviders: 2, maxLocalProviders: 2, maxApiProviders: 5 },
};

async function getFsReadFile() {
  const fs = await import("fs/promises");
  return vi.mocked(fs.readFile);
}

// ── Test suite ────────────────────────────────────────────────────────────────

describe("providerRegistry", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    // Reset in-module caches before each test
    invalidateRegistryCache();

    // Default: loadProviderConfig returns empty providers list
    vi.mocked(loadProviderConfig).mockResolvedValue({ providers: [] } as any);
  });

  // ── invalidateRegistryCache ───────────────────────────────────────────────

  describe("invalidateRegistryCache", () => {
    it("clears the registry cache so the next load re-reads from disk", async () => {
      const readFile = await getFsReadFile();
      readFile.mockResolvedValue(JSON.stringify(VALID_REGISTRY));

      await loadProviderRegistry(); // first load — populates cache
      expect(readFile).toHaveBeenCalledTimes(1);

      invalidateRegistryCache();

      readFile.mockResolvedValue(JSON.stringify(VALID_REGISTRY));
      await loadProviderRegistry(); // should re-read after invalidation
      expect(readFile).toHaveBeenCalledTimes(2);
    });
  });

  // ── loadProviderRegistry ──────────────────────────────────────────────────

  describe("loadProviderRegistry", () => {
    it("falls back to DEFAULT_REGISTRY when file read fails", async () => {
      const readFile = await getFsReadFile();
      readFile.mockRejectedValue(new Error("ENOENT"));

      const registry = await loadProviderRegistry();

      expect(registry.providers[0].name).toBe("openai");
      expect(logger.warn).toHaveBeenCalled();
    });

    it("falls back to DEFAULT_REGISTRY for oversized config files (>1 MB)", async () => {
      const readFile = await getFsReadFile();
      // 1.1 MB string
      readFile.mockResolvedValue("x".repeat(1_100_000));

      const registry = await loadProviderRegistry();

      expect(registry.providers[0].name).toBe("openai");
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ size: expect.any(Number), maxSize: expect.any(Number) }),
        expect.stringContaining("1 MB size limit")
      );
    });

    it("falls back to DEFAULT_REGISTRY when JSON is invalid", async () => {
      const readFile = await getFsReadFile();
      readFile.mockResolvedValue("not json {{{");

      const registry = await loadProviderRegistry();

      expect(registry.providers[0].name).toBe("openai");
    });

    it("falls back to DEFAULT_REGISTRY when registry has empty providers array", async () => {
      const readFile = await getFsReadFile();
      readFile.mockResolvedValue(JSON.stringify({ ...VALID_REGISTRY, providers: [] }));

      const registry = await loadProviderRegistry();
      expect(registry.providers[0].name).toBe("openai"); // DEFAULT_REGISTRY
    });

    it("falls back to DEFAULT_REGISTRY when a provider is missing required fields (empty name)", async () => {
      const invalidProv = { name: "", type: "api", baseUrl: "url", models: [], priority: 1, enabled: true };
      const readFile = await getFsReadFile();
      readFile.mockResolvedValue(JSON.stringify({ ...VALID_REGISTRY, providers: [invalidProv] }));

      const registry = await loadProviderRegistry();
      expect(registry.providers[0].name).toBe("openai");
    });

    it("falls back when provider has invalid type", async () => {
      const badProv = { ...VALID_PROVIDER, type: "invalid-type" };
      const readFile = await getFsReadFile();
      readFile.mockResolvedValue(JSON.stringify({ ...VALID_REGISTRY, providers: [badProv] }));

      const registry = await loadProviderRegistry();
      expect(registry.providers[0].name).toBe("openai");
    });

    it("falls back when provider has empty baseUrl", async () => {
      const badProv = { ...VALID_PROVIDER, baseUrl: "" };
      const readFile = await getFsReadFile();
      readFile.mockResolvedValue(JSON.stringify({ ...VALID_REGISTRY, providers: [badProv] }));

      const registry = await loadProviderRegistry();
      expect(registry.providers[0].name).toBe("openai");
    });

    it("falls back when registry has no fallbacks object", async () => {
      const noFallbacks = { providers: [VALID_PROVIDER] }; // missing fallbacks
      const readFile = await getFsReadFile();
      readFile.mockResolvedValue(JSON.stringify(noFallbacks));

      const registry = await loadProviderRegistry();
      expect(registry.providers[0].name).toBe("openai");
    });

    it("successfully loads and caches a valid registry", async () => {
      const readFile = await getFsReadFile();
      readFile.mockResolvedValue(JSON.stringify(VALID_REGISTRY));

      const registry = await loadProviderRegistry();

      expect(registry.providers[0].name).toBe("test-prov");
      expect(logger.info).toHaveBeenCalledWith(
        expect.objectContaining({ providerCount: 1 }),
        "Loaded provider registry"
      );
    });

    it("returns cached registry on second call without re-reading file", async () => {
      const readFile = await getFsReadFile();
      readFile.mockResolvedValue(JSON.stringify(VALID_REGISTRY));

      await loadProviderRegistry();
      await loadProviderRegistry();

      expect(readFile).toHaveBeenCalledTimes(1);
    });

    it("rejects provider with negative timeoutMs", async () => {
      const badProv = { ...VALID_PROVIDER, timeoutMs: -1 };
      const readFile = await getFsReadFile();
      readFile.mockResolvedValue(JSON.stringify({ ...VALID_REGISTRY, providers: [badProv] }));

      const registry = await loadProviderRegistry();
      expect(registry.providers[0].name).toBe("openai");
    });

    it("rejects provider with maxConcurrency < 1", async () => {
      const badProv = { ...VALID_PROVIDER, maxConcurrency: 0 };
      const readFile = await getFsReadFile();
      readFile.mockResolvedValue(JSON.stringify({ ...VALID_REGISTRY, providers: [badProv] }));

      const registry = await loadProviderRegistry();
      expect(registry.providers[0].name).toBe("openai");
    });
  });

  // ── getDerivedRegistry ─────────────────────────────────────────────────────

  describe("getDerivedRegistry", () => {
    it("falls back to loadProviderRegistry when adapters module import fails", async () => {
      const readFile = await getFsReadFile();
      readFile.mockRejectedValue(new Error("ENOENT"));

      // adapters/registry.js is not mocked here — import will fail
      const registry = await getDerivedRegistry();
      expect(registry).toBeDefined();
      expect(registry.providers[0].name).toBe("openai"); // DEFAULT_REGISTRY
    });
  });

  // ── resolveProvider ────────────────────────────────────────────────────────

  describe("resolveProvider", () => {
    it("uses baseUrl and maxTokens from config pattern match", async () => {
      vi.mocked(loadProviderConfig).mockResolvedValue({
        providers: [
          {
            pattern: "gpt-4",
            type: "openai-compat",
            baseUrl: "https://api.openai.com/v1",
            defaultMaxTokens: 2048,
            enabled: true,
          },
        ],
      } as any);

      const result = await resolveProvider({
        name: "p",
        type: "openai-compat",
        apiKey: "k",
        model: "gpt-4-turbo",
      });

      expect(result.type).toBe("openai-compat");
      expect(result.maxTokens).toBe(2048);
      expect(result.resolvedBaseUrl).toBe("https://api.openai.com/v1");
    });

    it("overrides type with matching config when type was openai-compat", async () => {
      vi.mocked(loadProviderConfig).mockResolvedValue({
        providers: [{ pattern: "claude", type: "anthropic", baseUrl: "", defaultMaxTokens: 4096, enabled: true }],
      } as any);

      const result = await resolveProvider({
        name: "p",
        type: "openai-compat",
        apiKey: "k",
        model: "claude-3-sonnet",
      });

      expect(result.type).toBe("anthropic");
    });

    it("does NOT override type when explicitly set to non-openai-compat", async () => {
      vi.mocked(loadProviderConfig).mockResolvedValue({
        providers: [{ pattern: "claude", type: "anthropic", baseUrl: "", defaultMaxTokens: 4096, enabled: true }],
      } as any);

      const result = await resolveProvider({
        name: "p",
        type: "google",
        apiKey: "k",
        model: "claude-3-sonnet",
      });

      expect(result.type).toBe("google");
    });

    it("keeps caller baseUrl when config also has a baseUrl", async () => {
      vi.mocked(loadProviderConfig).mockResolvedValue({
        providers: [{ pattern: "gpt", type: "openai-compat", baseUrl: "https://config-url.com", defaultMaxTokens: 1024, enabled: true }],
      } as any);

      const result = await resolveProvider({
        name: "p",
        type: "openai-compat",
        apiKey: "k",
        model: "gpt-4",
        baseUrl: "https://caller-url.com",
      });

      expect(result.resolvedBaseUrl).toBe("https://caller-url.com");
    });

    it("uses caller maxTokens when provided, skipping config default", async () => {
      vi.mocked(loadProviderConfig).mockResolvedValue({
        providers: [{ pattern: "gpt", type: "openai-compat", baseUrl: "", defaultMaxTokens: 999, enabled: true }],
      } as any);

      const result = await resolveProvider({
        name: "p",
        type: "openai-compat",
        apiKey: "k",
        model: "gpt-4",
        maxTokens: 500,
      });

      expect(result.maxTokens).toBe(500);
    });

    it("defaults to maxTokens=1024 when no config match and no caller maxTokens", async () => {
      vi.mocked(loadProviderConfig).mockResolvedValue({ providers: [] } as any);

      const result = await resolveProvider({
        name: "p",
        type: "openai-compat",
        apiKey: "k",
        model: "unknown-model",
      });

      expect(result.maxTokens).toBe(1024);
    });
  });

  // ── getProviders / getProviderByName / getProvidersByType ─────────────────

  describe("getProviders", () => {
    it("returns only enabled providers", async () => {
      const disabledProv = { ...VALID_PROVIDER, name: "disabled-p", enabled: false };
      const readFile = await getFsReadFile();
      readFile.mockResolvedValue(
        JSON.stringify({ ...VALID_REGISTRY, providers: [VALID_PROVIDER, disabledProv] })
      );

      const providers = await getProviders();
      expect(providers.every((p) => p.enabled)).toBe(true);
      expect(providers.find((p) => p.name === "disabled-p")).toBeUndefined();
    });
  });

  describe("getProviderByName", () => {
    it("returns the provider matching the given name", async () => {
      const readFile = await getFsReadFile();
      readFile.mockResolvedValue(JSON.stringify(VALID_REGISTRY));

      const p = await getProviderByName("test-prov");
      expect(p?.name).toBe("test-prov");
    });

    it("returns null when name does not match any enabled provider", async () => {
      const readFile = await getFsReadFile();
      readFile.mockResolvedValue(JSON.stringify(VALID_REGISTRY));

      const p = await getProviderByName("nonexistent");
      expect(p).toBeNull();
    });

    it("returns null when provider is disabled", async () => {
      const disabledProv = { ...VALID_PROVIDER, name: "disabled-p", enabled: false };
      const readFile = await getFsReadFile();
      readFile.mockResolvedValue(
        JSON.stringify({ ...VALID_REGISTRY, providers: [VALID_PROVIDER, disabledProv] })
      );

      const p = await getProviderByName("disabled-p");
      expect(p).toBeNull();
    });
  });

  describe("getProvidersByType", () => {
    it("returns only providers of the requested type", async () => {
      const localProv = { ...VALID_PROVIDER, name: "local-p", type: "local" as const };
      const readFile = await getFsReadFile();
      readFile.mockResolvedValue(
        JSON.stringify({ ...VALID_REGISTRY, providers: [VALID_PROVIDER, localProv] })
      );

      const apiProviders = await getProvidersByType("api");
      expect(apiProviders.every((p) => p.type === "api")).toBe(true);
      expect(apiProviders.find((p) => p.name === "local-p")).toBeUndefined();
    });

    it("returns empty array when no providers of requested type", async () => {
      const readFile = await getFsReadFile();
      readFile.mockResolvedValue(JSON.stringify(VALID_REGISTRY));

      const rpaProviders = await getProvidersByType("rpa");
      expect(rpaProviders).toHaveLength(0);
    });
  });

  // ── getFallbackProvider ────────────────────────────────────────────────────

  describe("getFallbackProvider", () => {
    it("returns the configured fallback for api type", async () => {
      const readFile = await getFsReadFile();
      readFile.mockResolvedValue(JSON.stringify(VALID_REGISTRY));

      const fallback = await getFallbackProvider("api");
      expect(fallback).toBe("test-prov");
    });

    it("returns null when no fallback configured for the type", async () => {
      const noRpaFallback = { ...VALID_REGISTRY, fallbacks: { api: "test-prov", local: "ollama" } };
      const readFile = await getFsReadFile();
      readFile.mockResolvedValue(JSON.stringify(noRpaFallback));

      const fallback = await getFallbackProvider("rpa");
      expect(fallback).toBeNull();
    });
  });

  // ── isProviderLimitReached ─────────────────────────────────────────────────

  describe("isProviderLimitReached", () => {
    it("returns false when active provider count is below the limit", async () => {
      const readFile = await getFsReadFile();
      readFile.mockResolvedValue(JSON.stringify(VALID_REGISTRY));

      // VALID_REGISTRY has 1 api provider, limit is 5
      const reached = await isProviderLimitReached("api");
      expect(reached).toBe(false);
    });

    it("returns true for rpa when active rpa count meets maxRpaProviders", async () => {
      const rpaProv1 = { ...VALID_PROVIDER, name: "rpa-1", type: "rpa" as const };
      const rpaProv2 = { ...VALID_PROVIDER, name: "rpa-2", type: "rpa" as const };
      const registry = {
        ...VALID_REGISTRY,
        providers: [rpaProv1, rpaProv2],
        limits: { maxRpaProviders: 2, maxLocalProviders: 2, maxApiProviders: 5 },
      };
      const readFile = await getFsReadFile();
      readFile.mockResolvedValue(JSON.stringify(registry));

      const reached = await isProviderLimitReached("rpa");
      expect(reached).toBe(true);
    });

    it("returns true for local when count meets maxLocalProviders", async () => {
      const localProv = { ...VALID_PROVIDER, name: "local-1", type: "local" as const };
      const localProv2 = { ...VALID_PROVIDER, name: "local-2", type: "local" as const };
      const registry = {
        ...VALID_REGISTRY,
        providers: [localProv, localProv2],
        limits: { maxRpaProviders: 2, maxLocalProviders: 2, maxApiProviders: 5 },
      };
      const readFile = await getFsReadFile();
      readFile.mockResolvedValue(JSON.stringify(registry));

      expect(await isProviderLimitReached("local")).toBe(true);
    });
  });

  // ── getProviderDefaults ────────────────────────────────────────────────────

  describe("getProviderDefaults", () => {
    it("returns default timeoutMs=60000 when not set on provider", () => {
      const p = { ...VALID_PROVIDER };
      const defaults = getProviderDefaults(p);
      expect(defaults.timeoutMs).toBe(60000);
    });

    it("returns default maxConcurrency=3 when not set on provider", () => {
      const p = { ...VALID_PROVIDER };
      const defaults = getProviderDefaults(p);
      expect(defaults.maxConcurrency).toBe(3);
    });

    it("returns custom timeoutMs when set on provider", () => {
      const p = { ...VALID_PROVIDER, timeoutMs: 30000 };
      const defaults = getProviderDefaults(p);
      expect(defaults.timeoutMs).toBe(30000);
    });

    it("returns custom maxConcurrency when set on provider", () => {
      const p = { ...VALID_PROVIDER, maxConcurrency: 10 };
      const defaults = getProviderDefaults(p);
      expect(defaults.maxConcurrency).toBe(10);
    });
  });
});
