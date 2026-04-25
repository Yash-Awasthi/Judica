import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// P11-42: Empty API keys accepted by registry
// P11-43: OpenRouter prefix routing
// P11-44: Singleton state isolation
// P11-45: Concurrency safety

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
  default: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("../../src/lib/ssrf.js", () => ({
  validateSafeUrl: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../src/lib/breaker.js", () => ({
  getBreaker: vi.fn((_provider: any, action: any) => ({
    fire: (...args: any[]) => action(...args),
  })),
}));

import {
  getAdapter,
  listAvailableProviders,
  registerAdapter,
  deregisterAdapter,
  hasAdapter,
  resolveProviderFromModel,
  resetRegistry,
} from "../../src/adapters/registry.js";

describe("P11-42: Empty API keys and registry validation", () => {
  it("should not register providers with empty API keys", () => {
    // MISTRAL_API_KEY is "" in mock env — should not be registered
    const providers = listAvailableProviders();
    expect(providers).not.toContain("mistral");
    expect(providers).not.toContain("cerebras");
    expect(providers).not.toContain("nvidia");
  });

  it("should register providers with non-empty API keys", () => {
    const providers = listAvailableProviders();
    expect(providers).toContain("openai");
    expect(providers).toContain("anthropic");
    expect(providers).toContain("gemini");
    expect(providers).toContain("groq");
    expect(providers).toContain("openrouter");
  });

  it("registerAdapter accepts any adapter (no key validation at registry level)", () => {
    const fakeAdapter = {
      providerId: "test-empty-key",
      generate: vi.fn(),
      listModels: vi.fn().mockResolvedValue([]),
      isAvailable: vi.fn().mockResolvedValue(true),
    };

    // Registry doesn't validate — this is the documented gap
    registerAdapter("test-empty-key", fakeAdapter as any);
    expect(hasAdapter("test-empty-key")).toBe(true);

    deregisterAdapter("test-empty-key");
  });
});

describe("P11-43: OpenRouter prefix routing", () => {
  it("should resolve models with org/ prefix correctly based on routing rules", () => {
    // org/model format routes to openrouter (slash rule)
    expect(resolveProviderFromModel("deepseek/deepseek-chat")).toBe("openrouter");
    expect(resolveProviderFromModel("anthropic/claude-3-haiku")).toBe("openrouter");
    expect(resolveProviderFromModel("mistral/mistral-large")).toBe("openrouter");
  });

  it("should prefer more specific providers over OpenRouter's generic slash rule", () => {
    // "claude-3-5-sonnet" starts with "claude" → anthropic takes priority
    expect(resolveProviderFromModel("claude-3-5-sonnet-20241022")).toBe("anthropic");
    // "gpt-4o" starts with "gpt-" → openai takes priority
    expect(resolveProviderFromModel("gpt-4o")).toBe("openai");
    // "gemini-2.0-flash" → gemini takes priority
    expect(resolveProviderFromModel("gemini-2.0-flash")).toBe("gemini");
  });

  it("should route llama models to groq (takes priority over ollama colon rule)", () => {
    // "llama3:8b" matches groq rule (starts with "llama3") before ollama colon rule
    expect(resolveProviderFromModel("llama3:8b")).toBe("groq");
    // "codellama:7b" has colon but doesn't match any specific rule → ollama
    expect(resolveProviderFromModel("phi3:mini")).toBe("ollama");
  });
});

describe("P11-44: Singleton state isolation", () => {
  afterEach(() => {
    // Clean up any test registrations
    if (hasAdapter("isolation-test")) deregisterAdapter("isolation-test");
  });

  it("should not leak state between register/deregister cycles", () => {
    const fake = {
      providerId: "isolation-test",
      generate: vi.fn(),
      listModels: vi.fn().mockResolvedValue([]),
      isAvailable: vi.fn().mockResolvedValue(true),
    };

    expect(hasAdapter("isolation-test")).toBe(false);
    registerAdapter("isolation-test", fake as any);
    expect(hasAdapter("isolation-test")).toBe(true);
    deregisterAdapter("isolation-test");
    expect(hasAdapter("isolation-test")).toBe(false);
  });

  it("resetRegistry clears all adapters and re-initializes", () => {
    const beforeCount = listAvailableProviders().length;
    resetRegistry();
    // After reset, ensureInitialized runs on next access
    const afterCount = listAvailableProviders().length;
    expect(afterCount).toBe(beforeCount); // same providers re-registered
  });
});

describe("P11-45: Concurrent operations safety", () => {
  it("should handle concurrent adapter lookups without errors", async () => {
    const lookups = Array.from({ length: 100 }, (_, i) =>
      Promise.resolve().then(() => {
        if (i % 2 === 0) return getAdapter("openai");
        return getAdapter("anthropic");
      })
    );

    const results = await Promise.all(lookups);
    expect(results).toHaveLength(100);
    for (let i = 0; i < 100; i++) {
      expect(results[i].providerId).toBe(i % 2 === 0 ? "openai" : "anthropic");
    }
  });

  it("should handle concurrent register/deregister without corruption", async () => {
    const ops = Array.from({ length: 50 }, (_, i) =>
      Promise.resolve().then(() => {
        const id = `concurrent-${i}`;
        const fake = {
          providerId: id,
          generate: vi.fn(),
          listModels: vi.fn().mockResolvedValue([]),
          isAvailable: vi.fn().mockResolvedValue(true),
        };
        registerAdapter(id, fake as any);
        expect(hasAdapter(id)).toBe(true);
        deregisterAdapter(id);
      })
    );

    await Promise.all(ops);
    // None should remain
    for (let i = 0; i < 50; i++) {
      expect(hasAdapter(`concurrent-${i}`)).toBe(false);
    }
  });
});
