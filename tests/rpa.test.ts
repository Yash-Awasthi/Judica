import { describe, it, expect, vi, beforeEach } from "vitest";
import { askProvider, Provider } from "../src/lib/providers.js";
import { getFallbackProvider } from "../src/config/fallbacks.js";

// Mock dependencies
vi.mock("../src/lib/providers/concrete/rpa.js", () => {
  const mockCreateConnector = vi.fn(async (baseUrl: string, apiKey: string, model: string) => {
    if (baseUrl?.startsWith("rpa://")) {
      const target = baseUrl.replace("rpa://", "");
      if (target === "chatgpt" || target === "claude") {
        return new (class MockRPAConnector {
          async generate(prompt: string): Promise<string> {
            return `RPA response: ${prompt}`;
          }
        })();
      }
    }
    return null;
  });

  return {
    RPAProvider: mockCreateConnector,
    OllamaConnector: class OllamaConnector {},
    RPAConnector: class RPAConnector {
      async generate(prompt: string): Promise<string> {
        return `RPA response: ${prompt}`;
      }
    }
  };
});

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

describe("RPA Provider Tests", () => {
  const mockRPAProvider: Provider = {
    name: "chatgpt-rpa",
    type: "rpa",
    apiKey: "mock-key",
    model: "gpt-4",
    baseUrl: "rpa://chatgpt"
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    // Restore the RPAProvider mock after clearing
    const { RPAProvider } = vi.mocked(await import("../src/lib/providers/concrete/rpa.js"));
    RPAProvider.mockImplementation((baseUrl: string, apiKey: string, model: string) => {
      if (baseUrl?.startsWith("rpa://")) {
        const target = baseUrl.replace("rpa://", "");
        if (target === "chatgpt" || target === "claude") {
          return new (class MockRPAConnector {
            async generate(prompt: string): Promise<string> {
              return `RPA response: ${prompt}`;
            }
          })() as any;
        }
      }
      return null;
    });
  });

  // TEST 1: SUCCESS TEST
  describe("SUCCESS TEST", () => {
    it.skip("should return non-empty string response for valid RPA provider", async () => {
      const response = await askProvider(mockRPAProvider, "Test prompt");
      
      expect(response).toBeDefined();
      expect(response.text).toBeDefined();
      expect(typeof response.text).toBe("string");
      expect(response.text.length).toBeGreaterThan(0);
      expect(response.usage).toBeDefined();
    });

    it.skip("should return usage stats with response", async () => {
      const response = await askProvider(mockRPAProvider, "Test prompt");
      
      expect(response).toBeDefined();
      expect(response.usage).toBeDefined();
      expect(response.usage?.promptTokens).toBeGreaterThan(0);
      expect(response.usage?.completionTokens).toBeGreaterThan(0);
      expect(response.usage?.totalTokens).toBeGreaterThan(0);
    });
  });

  // TEST 2: TIMEOUT TEST
  describe("TIMEOUT TEST", () => {
    it("should throw error when RPA request times out", async () => {
      // Create a temporary mock provider with very short timeout
      const timeoutProvider = {
        ...mockRPAProvider,
        timeoutMs: 1 // 1ms timeout
      };

      await expect(
        askProvider(timeoutProvider, "Test prompt")
      ).rejects.toThrow();
    });

    it("should handle timeout via AbortSignal", async () => {
      const controller = new AbortController();
      
      // Abort immediately
      controller.abort();

      await expect(
        askProvider(mockRPAProvider, "Test prompt", false, controller.signal)
      ).rejects.toThrow();
    });
  });

  // TEST 3: LOGIN FAILURE TEST
  describe("LOGIN FAILURE TEST", () => {
    it("should throw error when RPA session is missing or expired", async () => {
      // Create a provider with invalid baseUrl that will trigger connector error
      const invalidProvider = {
        ...mockRPAProvider,
        baseUrl: "rpa://invalid-target"
      };

      await expect(
        askProvider(invalidProvider, "Test prompt")
      ).rejects.toThrow(/rpa provider request failed/);
    });

    it("should throw error when connector cannot be created", async () => {
      // Create a provider with baseUrl that won't match any RPA target
      const noConnectorProvider = {
        ...mockRPAProvider,
        baseUrl: "rpa://nonexistent"
      };

      await expect(
        askProvider(noConnectorProvider, "Test prompt")
      ).rejects.toThrow(/rpa provider request failed/);
    });

    it("should throw error for invalid baseUrl format", async () => {
      const invalidProvider: Provider = {
        ...mockRPAProvider,
        baseUrl: "invalid://url"
      };

      await expect(
        askProvider(invalidProvider, "Test prompt")
      ).rejects.toThrow();
    });
  });

  // TEST 4: FALLBACK TEST
  describe("FALLBACK TEST", () => {
    it("should fallback to API provider when RPA fails", async () => {
      const { RPAProvider } = await import("../src/lib/providers/concrete/rpa.js");
      
      // Mock failing RPA connector
      const MockFailingConnector = class {
        async generate(): Promise<string> {
          throw new Error("RPA failed: DOM element not found");
        }
      };
      
      vi.mocked(RPAProvider).mockReturnValue(new MockFailingConnector() as any);

      // Mock fallback provider
      const mockFallbackProvider: Provider = {
        name: "openai-api",
        type: "api",
        apiKey: "fallback-key",
        model: "gpt-4"
      };
      
      vi.mocked(getFallbackProvider).mockReturnValue(mockFallbackProvider);

      // The askProvider should attempt to use fallback
      // Note: This test verifies the fallback path is triggered
      // The actual fallback request would need API mocking
      await expect(
        askProvider(mockRPAProvider, "Test prompt")
      ).rejects.toThrow(); // Will fail because fallback API isn't mocked

      // Verify fallback was checked
      expect(getFallbackProvider).toHaveBeenCalledWith(mockRPAProvider);
    });

    it("should not fallback if already in fallback mode", async () => {
      const { RPAProvider } = await import("../src/lib/providers/concrete/rpa.js");
      
      const MockFailingConnector = class {
        async generate(): Promise<string> {
          throw new Error("RPA failed");
        }
      };
      
      vi.mocked(RPAProvider).mockReturnValue(new MockFailingConnector() as any);
      vi.mocked(getFallbackProvider).mockReturnValue({
        name: "fallback",
        type: "api",
        apiKey: "key",
        model: "gpt-4"
      } as Provider);

      // isFallback = true - should not trigger another fallback
      await expect(
        askProvider(mockRPAProvider, "Test prompt", true)
      ).rejects.toThrow("rpa provider request failed");

      // Fallback should not be requested when isFallback is true
      expect(getFallbackProvider).not.toHaveBeenCalled();
    });
  });

  // SAFETY RULES TESTS
  describe("SAFETY RULES", () => {
    it.skip("should always return string format", async () => {
      const { RPAProvider } = await import("../src/lib/providers/concrete/rpa.js");
      
      const MockRPAConnector = class {
        async generate(): Promise<string> {
          return "Response";
        }
      };
      
      vi.mocked(RPAProvider).mockReturnValue(new MockRPAConnector() as any);

      const result = await askProvider(mockRPAProvider, "Test");

      expect(typeof result.text).toBe("string");
    });

    it("should catch and log all errors", async () => {
      const { RPAProvider } = await import("../src/lib/providers/concrete/rpa.js");
      const logger = await import("../src/lib/logger.js");
      
      const MockFailingConnector = class {
        async generate(): Promise<string> {
          throw new Error("Simulated error");
        }
      };
      
      vi.mocked(RPAProvider).mockReturnValue(new MockFailingConnector() as any);

      await expect(
        askProvider(mockRPAProvider, "Test")
      ).rejects.toThrow();

      // Verify error was logged
      expect(logger.default.warn).toHaveBeenCalled();
    });

    it("should never crash the council - errors are always caught", async () => {
      const { RPAProvider } = await import("../src/lib/providers/concrete/rpa.js");
      
      const MockCrashConnector = class {
        async generate(): Promise<string> {
          throw new Error("Crash!");
        }
      };
      
      vi.mocked(RPAProvider).mockReturnValue(new MockCrashConnector() as any);

      // Should throw but not crash the process
      let error: Error | undefined;
      try {
        await askProvider(mockRPAProvider, "Test");
      } catch (e) {
        error = e as Error;
      }

      expect(error).toBeDefined();
      expect(error?.message).toContain("failed");
    });
  });

  // PROVIDER TYPE VALIDATION
  describe("PROVIDER TYPE VALIDATION", () => {
    it("should throw error for missing provider type", async () => {
      const invalidProvider = {
        ...mockRPAProvider,
        type: undefined as any
      };

      await expect(
        askProvider(invalidProvider, "Test")
      ).rejects.toThrow(/api provider request failed/);
    });

    it("should throw error for invalid provider type", async () => {
      const invalidProvider = {
        ...mockRPAProvider,
        type: "invalid-type" as any
      };

      await expect(
        askProvider(invalidProvider, "Test")
      ).rejects.toThrow(/api provider request failed/);
    });
  });
});

describe("RPA Integration Tests", () => {
  it.skip("should handle message array input", async () => {
    const { RPAProvider } = await import("../src/lib/providers/concrete/rpa.js");
    
    const mockGenerate = vi.fn().mockResolvedValue("Response to messages");
    const MockRPAConnector = class {
      async generate(prompt: string): Promise<string> {
        return mockGenerate(prompt);
      }
    };
    
    vi.mocked(RPAProvider).mockReturnValue(new MockRPAConnector() as any);

    const provider: Provider = {
      name: "chatgpt-rpa",
      type: "rpa",
      apiKey: "key",
      model: "gpt-4",
      baseUrl: "rpa://chatgpt"
    };

    const messages = [
      { role: "user" as const, content: "Hello" },
      { role: "assistant" as const, content: "Hi there" },
      { role: "user" as const, content: "How are you?" }
    ];

    await askProvider(provider, messages);

    // Should concatenate message contents
    expect(mockGenerate).toHaveBeenCalledWith("Hello\nHi there\nHow are you?");
  });

  it.skip("should handle string input", async () => {
    const { RPAProvider } = await import("../src/lib/providers/concrete/rpa.js");
    
    const mockGenerate = vi.fn().mockResolvedValue("Response");
    const MockRPAConnector = class {
      async generate(prompt: string): Promise<string> {
        return mockGenerate(prompt);
      }
    };
    
    vi.mocked(RPAProvider).mockReturnValue(new MockRPAConnector() as any);

    const provider: Provider = {
      name: "chatgpt-rpa",
      type: "rpa",
      apiKey: "key",
      model: "gpt-4",
      baseUrl: "rpa://chatgpt"
    };

    await askProvider(provider, "Simple string prompt");

    expect(mockGenerate).toHaveBeenCalledWith("Simple string prompt");
  });
});
