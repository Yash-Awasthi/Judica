import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock all dependencies that registry.ts imports
vi.mock("../../src/config/env.js", () => ({
  env: {
    OPENAI_API_KEY: "sk-test-openai",
    ANTHROPIC_API_KEY: "sk-ant-test",
    GOOGLE_API_KEY: "AIzaSyTest",
    GROQ_API_KEY: "gsk_test",
    OPENROUTER_API_KEY: "sk-or-test",
    OLLAMA_BASE_URL: "http://localhost:11434",
    MISTRAL_API_KEY: "",
    CEREBRAS_API_KEY: "",
    NVIDIA_API_KEY: "",
  },
}));

vi.mock("../../src/lib/logger.js", () => ({
  default: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("../../src/lib/ssrf.js", () => ({
  validateSafeUrl: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../src/lib/breaker.js", () => ({
  getBreaker: vi.fn((_provider: any, action: any) => ({
    fire: (...args: any[]) => action(...args),
  })),
}));

vi.mock("../../src/lib/cost.js", () => ({
  calculateCost: vi.fn().mockReturnValue(0),
}));

import {
  getAdapter,
  getAdapterOrNull,
  listAvailableProviders,
  registerAdapter,
  deregisterAdapter,
  hasAdapter,
  resolveProviderFromModel,
} from "../../src/adapters/registry.js";

describe("Adapter Registry", () => {
  describe("getAdapter", () => {
    it("returns the adapter for a known provider", () => {
      const adapter = getAdapter("openai");
      expect(adapter).toBeDefined();
      expect(adapter.providerId).toBe("openai");
    });

    it("returns the anthropic adapter", () => {
      const adapter = getAdapter("anthropic");
      expect(adapter).toBeDefined();
      expect(adapter.providerId).toBe("anthropic");
    });

    it("returns the gemini adapter", () => {
      const adapter = getAdapter("gemini");
      expect(adapter).toBeDefined();
      expect(adapter.providerId).toBe("gemini");
    });

    it("returns the groq adapter", () => {
      const adapter = getAdapter("groq");
      expect(adapter).toBeDefined();
      expect(adapter.providerId).toBe("groq");
    });

    it("returns the ollama adapter", () => {
      const adapter = getAdapter("ollama");
      expect(adapter).toBeDefined();
      expect(adapter.providerId).toBe("ollama");
    });

    it("throws for unknown provider", () => {
      expect(() => getAdapter("nonexistent-provider")).toThrow(
        /No adapter registered for provider "nonexistent-provider"/
      );
    });
  });

  describe("getAdapterOrNull", () => {
    it("returns the adapter for a known provider", () => {
      const adapter = getAdapterOrNull("openai");
      expect(adapter).not.toBeNull();
      expect(adapter!.providerId).toBe("openai");
    });

    it("returns null for unknown provider", () => {
      const adapter = getAdapterOrNull("nonexistent");
      expect(adapter).toBeNull();
    });
  });

  describe("listAvailableProviders", () => {
    it("returns all registered provider IDs", () => {
      const providers = listAvailableProviders();
      expect(providers).toContain("openai");
      expect(providers).toContain("anthropic");
      expect(providers).toContain("gemini");
      expect(providers).toContain("groq");
      expect(providers).toContain("ollama");
      expect(providers).toContain("openrouter");
    });

    it("returns an array", () => {
      const providers = listAvailableProviders();
      expect(Array.isArray(providers)).toBe(true);
    });
  });

  describe("registerAdapter / deregisterAdapter", () => {
    it("registers a new adapter and it becomes retrievable", () => {
      const fakeAdapter = {
        providerId: "test-custom",
        generate: vi.fn(),
        listModels: vi.fn().mockResolvedValue([]),
        isAvailable: vi.fn().mockResolvedValue(true),
      };

      registerAdapter("test-custom", fakeAdapter as any);

      expect(hasAdapter("test-custom")).toBe(true);
      expect(getAdapter("test-custom")).toBe(fakeAdapter);

      // Clean up
      deregisterAdapter("test-custom");
      expect(hasAdapter("test-custom")).toBe(false);
    });

    it("overwrites an existing adapter if re-registered", () => {
      const fakeAdapter1 = {
        providerId: "test-overwrite",
        generate: vi.fn(),
        listModels: vi.fn().mockResolvedValue([]),
        isAvailable: vi.fn().mockResolvedValue(true),
      };
      const fakeAdapter2 = {
        providerId: "test-overwrite-v2",
        generate: vi.fn(),
        listModels: vi.fn().mockResolvedValue(["model-a"]),
        isAvailable: vi.fn().mockResolvedValue(true),
      };

      registerAdapter("test-overwrite", fakeAdapter1 as any);
      registerAdapter("test-overwrite", fakeAdapter2 as any);

      expect(getAdapter("test-overwrite")).toBe(fakeAdapter2);

      // Clean up
      deregisterAdapter("test-overwrite");
    });
  });

  describe("hasAdapter", () => {
    it("returns true for registered providers", () => {
      expect(hasAdapter("openai")).toBe(true);
      expect(hasAdapter("anthropic")).toBe(true);
    });

    it("returns false for unregistered providers", () => {
      expect(hasAdapter("fake-provider")).toBe(false);
    });
  });

  describe("resolveProviderFromModel", () => {
    it("resolves OpenAI models", () => {
      expect(resolveProviderFromModel("gpt-4o")).toBe("openai");
      expect(resolveProviderFromModel("gpt-3.5-turbo")).toBe("openai");
      expect(resolveProviderFromModel("o1-preview")).toBe("openai");
      expect(resolveProviderFromModel("o3-mini")).toBe("openai");
    });

    it("resolves Anthropic models", () => {
      expect(resolveProviderFromModel("claude-3-5-sonnet-20241022")).toBe("anthropic");
      expect(resolveProviderFromModel("claude-opus-4-20250514")).toBe("anthropic");
    });

    it("resolves Gemini models", () => {
      expect(resolveProviderFromModel("gemini-2.0-flash")).toBe("gemini");
      expect(resolveProviderFromModel("gemini-pro")).toBe("gemini");
    });

    it("returns null for unknown models", () => {
      expect(resolveProviderFromModel("completely-unknown-model")).toBeNull();
    });
  });

  describe("registry contains all expected providers", () => {
    it("has at least openai, anthropic, gemini, groq, ollama", () => {
      const providers = listAvailableProviders();
      const expected = ["openai", "anthropic", "gemini", "groq", "ollama"];
      for (const p of expected) {
        expect(providers).toContain(p);
      }
    });
  });
});
