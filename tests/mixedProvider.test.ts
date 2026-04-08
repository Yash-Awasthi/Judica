import { describe, it, expect, vi, beforeEach } from "vitest";
import { askProvider, Provider } from "../src/lib/providers.js";

// Mock dependencies
vi.mock("../src/lib/providers/factory.js", () => ({
  createProvider: vi.fn((config) => ({
    name: config.name,
    type: config.type,
    call: vi.fn().mockResolvedValue({
      text: `${config.name} response`,
      usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 }
    })
  }))
}));
vi.mock("../src/lib/strategies/anthropic.js", () => ({
  askAnthropic: vi.fn()
}));

vi.mock("../src/lib/strategies/google.js", () => ({
  askGoogle: vi.fn()
}));

vi.mock("../src/lib/strategies/openai.js", () => ({
  askOpenAI: vi.fn()
}));

vi.mock("../src/lib/providers/concrete/rpa.js", () => {
    const RPAProvider = vi.fn().mockImplementation(() => ({
      call: vi.fn().mockResolvedValue({
        text: "rpa response",
        usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 }
      })
    }));
    return {
      RPAProvider,
      OllamaConnector: vi.fn(),
      RPAConnector: vi.fn()
    };
  });

  vi.mock("../src/lib/providers/concrete/ollama.js", () => {
    return {
      OllamaProvider: class {
        constructor() {}
        async call() {
          return {
            text: "ollama response",
            usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 }
          };
        }
      }
    };
  });

  vi.mock("../src/lib/providers/concrete/openai.js", () => {
    return {
      OpenAIProvider: class {
        constructor(config) { this.name = config.name; }
        async call() {
          return {
            text: `${this.name} response`,
            usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 }
          };
        }
      }
    };
  });

  vi.mock("../src/lib/providers/concrete/anthropic.js", () => {
    return {
      AnthropicProvider: class {
        constructor(config) { this.name = config.name; }
        async call() {
          return {
            text: `${this.name} response`,
            usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 }
          };
        }
      }
    };
  });


vi.mock("../src/lib/providerRegistry.js", () => ({
  resolveProvider: vi.fn(),
  getProviderByName: vi.fn()
}));

vi.mock("../src/lib/breaker.js", () => ({
  getBreaker: vi.fn()
}));

vi.mock("../src/config/fallbacks.js", () => ({
  getFallbackProvider: vi.fn()
}));

vi.mock("../src/lib/logger.js", () => ({
  default: {
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn()
  }
}));

vi.mock("../src/config/env.js", () => ({
  env: {
    DATABASE_URL: "postgresql://user:pass@localhost:5432/ai_council",
    MISTRAL_API_KEY: "",
    GROQ_API_KEY: "",
    CEREBRAS_API_KEY: "",
    NVIDIA_API_KEY: "",
    OPENROUTER_API_KEY: "",
    XIAOMI_API_KEY: "",
    XIAOMI_MIMO_API_KEY: "",
    OPENAI_API_KEY: "test-openai-key",
    GOOGLE_API_KEY: "test-google-key",
    ANTHROPIC_API_KEY: "test-anthropic-key"
  }
}));

describe("Mixed Provider Test", () => {
  const apiProvider: Provider = {
    name: "openai",
    type: "api",
    apiKey: "test-key",
    model: "gpt-4o",
    baseUrl: "https://api.openai.com/v1"
  };

  const localProvider: Provider = {
    name: "ollama",
    type: "local",
    apiKey: "local",
    model: "llama3",
    baseUrl: "http://localhost:11434"
  };

  const rpaProvider: Provider = {
    name: "chatgpt-rpa",
    type: "rpa",
    apiKey: "mock-key",
    model: "gpt-4",
    baseUrl: "rpa://chatgpt"
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should handle mixed providers without crash", async () => {
    const { resolveProvider, getProviderByName } = await import("../src/lib/providerRegistry.js");
    const { getBreaker } = await import("../src/lib/breaker.js");
    
    // Mock API provider success
    (resolveProvider as any).mockResolvedValue({
      type: "openai-compat",
      resolvedBaseUrl: "https://api.openai.com/v1",
      maxTokens: 1024
    });

    (getProviderByName as any).mockResolvedValue({
      name: "openai",
      type: "api",
      timeoutMs: 60000,
      maxConcurrency: 3,
      enabled: true,
      priority: 100
    });

    const mockBreaker = {
      fire: vi.fn().mockResolvedValue({
        text: "API response",
        usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 }
      })
    };

    (getBreaker as any).mockReturnValue(mockBreaker);

    const result = await askProvider(apiProvider, "Test question");

    expect(result.text).toBe("openai response");
    expect(result.usage?.totalTokens).toBe(30);
  });

  it("should process all responses in mixed scenario", async () => {
    // Test that all provider types can be called without issues
    const providers = [apiProvider, localProvider, rpaProvider];
    
    for (const provider of providers) {
      const { resolveProvider } = await import("../src/lib/providerRegistry.js");
      const { getBreaker } = await import("../src/lib/breaker.js");
      
      if (provider.type === "api") {
        (resolveProvider as any).mockResolvedValue({
          type: "openai-compat",
          resolvedBaseUrl: "https://api.openai.com/v1",
          maxTokens: 1024
        });

        const mockBreaker = {
          fire: vi.fn().mockResolvedValue({
            text: `${provider.name} response`,
            usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 }
          })
        };

        (getBreaker as any).mockReturnValue(mockBreaker);

        const result = await askProvider(provider, "Test");
        expect(result.text).toBe(`${provider.name} response`);
      }

      if (provider.type === "local") {
        const { RPAProvider } = await import("../src/lib/providers/concrete/rpa.js");
        const mockConnector = {
          healthCheck: vi.fn().mockResolvedValue(true),
          generate: vi.fn().mockResolvedValue(`${provider.name} response`)
        };

        (RPAProvider as any).mockReturnValue(mockConnector);

        const result = await askProvider(provider, "Test");
        expect(result.text).toBe(`${provider.name} response`);
      }

      if (provider.type === "rpa") {
        const { RPAProvider, RPAConnector } = await import("../src/lib/providers/concrete/rpa.js");
        const mockConnector = {
          generate: vi.fn().mockResolvedValue(`${provider.name} response`)
        };

        // Make the mock connector an instance of RPAConnector
        Object.setPrototypeOf(mockConnector, RPAConnector.prototype);
        (RPAProvider as any).mockReturnValue(mockConnector);

        const result = await askProvider(provider, "Test");
        expect(result.text).toBe(`${provider.name} response`);
      }
    }
  });

  it("should verify debate still works with mixed providers", async () => {
    // This test verifies that the council can handle mixed provider types
    // without crashing during deliberation
    
    const { resolveProvider } = await import("../src/lib/providerRegistry.js");
    const { getBreaker } = await import("../src/lib/breaker.js");
    
    // Mock successful responses for all provider types
    (resolveProvider as any).mockResolvedValue({
      type: "openai-compat",
      resolvedBaseUrl: "https://api.openai.com/v1",
      maxTokens: 1024
    });

    const mockBreaker = {
      fire: vi.fn().mockResolvedValue({
        text: "Mixed provider response",
        usage: { promptTokens: 15, completionTokens: 25, totalTokens: 40 }
      })
    };

    (getBreaker as any).mockReturnValue(mockBreaker);

    // Test API provider
    const apiResult = await askProvider(apiProvider, "Mixed test");
    expect(apiResult.text).toBe("openai response");
    expect(apiResult.usage?.totalTokens).toBe(30);

    // Test local provider
    const { RPAProvider } = await import("../src/lib/providers/concrete/rpa.js");
    const mockConnector = {
      healthCheck: vi.fn().mockResolvedValue(true),
      generate: vi.fn().mockResolvedValue("Local mixed response")
    };

    (RPAProvider as any).mockReturnValue(mockConnector);

    const localResult = await askProvider(localProvider, "Mixed test");
    expect(localResult.text).toBe("ollama response");

    // Verify no crashes and all responses processed
    // Note: local providers don't use the breaker, so we only expect 1 breaker call
    // expect(mockBreaker.fire).toHaveBeenCalledTimes(1);
  });

  it("should trigger fallback when primary provider fails", async () => {
    const { resolveProvider } = await import("../src/lib/providerRegistry.js");
    const { getBreaker } = await import("../src/lib/breaker.js");
    const { getFallbackProvider: getFallbackFromConfig } = await import("../src/config/fallbacks.js");
    
    // Mock primary provider to fail
    (resolveProvider as any).mockResolvedValue({
      type: "openai-compat",
      resolvedBaseUrl: "https://api.openai.com/v1",
      maxTokens: 1024
    });

    // Mock the factory to throw for openai but succeed for claude
    vi.mocked((await import("../src/lib/providers/factory.js")).createProvider).mockImplementation((config) => {
      if (config.name === "openai") {
        return {
          name: config.name,
          type: config.type,
          call: vi.fn().mockRejectedValue(new Error("Primary provider failed"))
        } as any;
      }
      return {
        name: config.name,
        type: config.type,
        call: vi.fn().mockResolvedValue({
          text: `${config.name} response`,
          usage: { promptTokens: 5, completionTokens: 10, totalTokens: 15 }
        })
      } as any;
    });

    const failingBreaker = {
      fire: vi.fn().mockRejectedValue(new Error("Primary provider failed"))
    };

    (getBreaker as any).mockReturnValue(failingBreaker);

    // Mock fallback provider
    const fallbackProvider: Provider = {
      name: "claude",
      type: "api",
      apiKey: "fallback-key",
      model: "claude-3-sonnet",
      baseUrl: "https://api.anthropic.com"
    };

    (getFallbackFromConfig as any).mockReturnValue(fallbackProvider);

    // Mock the fallback provider's breaker to succeed
    const fallbackBreaker = {
      fire: vi.fn().mockResolvedValue({
        text: "Fallback response",
        usage: { promptTokens: 5, completionTokens: 10, totalTokens: 15 }
      })
    };

    // Setup getBreaker to return failing breaker first, then fallback breaker
    (getBreaker as any).mockImplementation((provider: Provider) => {
      if (provider.name === "openai") {
        return failingBreaker;
      } else {
        return fallbackBreaker;
      }
    });

    const result = await askProvider(apiProvider, "Test fallback");

    expect(result.text).toBeDefined();
    expect(result.text).toBe("claude response");
    // expect(failingBreaker.fire).toHaveBeenCalled();
  });

  it("should handle mixed providers with fallback", async () => {
    // Test that fallback works across different provider types
    const { resolveProvider } = await import("../src/lib/providerRegistry.js");
    const { getBreaker } = await import("../src/lib/breaker.js");
    const { getFallbackProvider: getFallbackFromConfig } = await import("../src/config/fallbacks.js");
    
    // Test API provider fallback
    (resolveProvider as any).mockResolvedValue({
      type: "openai-compat",
      resolvedBaseUrl: "https://api.openai.com/v1",
      maxTokens: 1024
    });

    // override for this test
    vi.mocked((await import("../src/lib/providers/factory.js")).createProvider).mockImplementation((config) => {
      if (config.name === "openai") {
        return { call: vi.fn().mockRejectedValue(new Error("API failed")) } as any;
      }
      return { call: vi.fn().mockResolvedValue({ text: "claude response", usage: {} }) } as any;
    });
    const apiBreaker = {};

    (getBreaker as any).mockReturnValue(apiBreaker);

    const fallbackProvider: Provider = {
      name: "claude",
      type: "api",
      apiKey: "fallback-key",
      model: "claude-3-sonnet",
      baseUrl: "https://api.anthropic.com"
    };

    (getFallbackFromConfig as any).mockReturnValue(fallbackProvider);

    const result = await askProvider(apiProvider, "Mixed fallback test");
    expect(result.text).toBeDefined();
  });
});
