import { describe, it, expect, vi, beforeEach } from "vitest";
import { askProvider, Provider } from "../src/lib/providers.js";

// Mock dependencies
vi.mock("../src/lib/strategies/anthropic.js", () => ({
  askAnthropic: vi.fn()
}));

vi.mock("../src/lib/strategies/google.js", () => ({
  askGoogle: vi.fn()
}));

vi.mock("../src/lib/strategies/openai.js", () => ({
  askOpenAI: vi.fn()
}));

vi.mock("../src/lib/connectors/index.js", () => ({
  createConnector: vi.fn()
}));

vi.mock("../src/lib/providerRegistry.js", () => ({
  resolveProvider: vi.fn(),
  getBreaker: vi.fn()
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

describe("Provider Execution Tests", () => {
  const mockAPIProvider: Provider = {
    name: "openai",
    type: "api",
    apiKey: "test-key",
    model: "gpt-4o",
    baseUrl: "https://api.openai.com/v1"
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should validate provider type field exists", async () => {
    const invalidProvider = {
      ...mockAPIProvider,
      type: undefined as any
    };

    await expect(askProvider(invalidProvider, "Hello"))
      .rejects.toThrow("missing required 'type' field");
  });

  it("should validate provider type is valid", async () => {
    const invalidProvider = {
      ...mockAPIProvider,
      type: "invalid" as any
    };

    await expect(askProvider(invalidProvider, "Hello"))
      .rejects.toThrow("invalid type 'invalid'. Must be 'api', 'local', or 'rpa'");
  });

  it("should handle provider failure gracefully", async () => {
    const { resolveProvider } = await import("../src/lib/providerRegistry.js");
    const { getBreaker } = await import("../src/lib/breaker.js");
    
    (resolveProvider as any).mockResolvedValue({
      type: "openai-compat",
      resolvedBaseUrl: "https://api.openai.com/v1",
      maxTokens: 1024
    });

    const mockBreaker = {
      fire: vi.fn().mockRejectedValue(new Error("Provider request failed"))
    };

    (getBreaker as any).mockReturnValue(mockBreaker);

    await expect(askProvider(mockAPIProvider, "Hello"))
      .rejects.toThrow("api provider request failed");
  });
});
