import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock dependencies
vi.mock("../../src/lib/providers/factory.js", () => ({
  createProvider: vi.fn(),
}));

vi.mock("../../src/config/fallbacks.js", () => ({
  getFallbackProvider: vi.fn(),
}));

vi.mock("../../src/lib/retry.js", () => ({
  withRetry: vi.fn((fn) => fn()),
}));

vi.mock("../../src/lib/logger.js", () => ({
  default: {
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

describe("Providers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("askProvider", () => {
    it("should call the created provider and return its response", async () => {
      const { askProvider } = await import("../../src/lib/providers.js");
      const { createProvider } = await import("../../src/lib/providers/factory.js");

      const providerMock = {
        call: vi.fn().mockResolvedValue({ content: "hello" }),
      };
      vi.mocked(createProvider).mockReturnValue(providerMock as any);

      const config = { name: "test", type: "openai" } as any;
      const result = await askProvider(config, "hi");

      expect(result.content).toBe("hello");
      expect(providerMock.call).toHaveBeenCalled();
    });

    it("should attempt fallback if primary fails", async () => {
      const { askProvider } = await import("../../src/lib/providers.js");
      const { createProvider } = await import("../../src/lib/providers/factory.js");
      const { getFallbackProvider } = await import("../../src/config/fallbacks.js");

      const failProvider = { call: vi.fn().mockRejectedValue(new Error("fail")) };
      const successProvider = { call: vi.fn().mockResolvedValue({ content: "fallback-ok" }) };
      
      vi.mocked(createProvider)
        .mockReturnValueOnce(failProvider as any)
        .mockReturnValueOnce(successProvider as any);

      const fallbackConfig = { name: "fallback", type: "anthropic" };
      vi.mocked(getFallbackProvider).mockReturnValue(fallbackConfig as any);

      const config = { name: "test", type: "openai" } as any;
      const result = await askProvider(config, "hi");

      expect(result.content).toBe("fallback-ok");
      expect(createProvider).toHaveBeenCalledTimes(2);
    });

    it("should throw if fallback is also disabled or missing", async () => {
        const { askProvider } = await import("../../src/lib/providers.js");
        const { createProvider } = await import("../../src/lib/providers/factory.js");
        const { getFallbackProvider } = await import("../../src/config/fallbacks.js");
  
        vi.mocked(createProvider).mockReturnValue({ call: vi.fn().mockRejectedValue(new Error("fail")) } as any);
        vi.mocked(getFallbackProvider).mockReturnValue(null);
  
        const config = { name: "test", type: "openai" } as any;
        await expect(askProvider(config, "hi")).rejects.toThrow("openai provider request failed");
    });
  });

  describe("askProviderStream", () => {
    it("should call withRetry and askProvider", async () => {
        const { askProviderStream } = await import("../../src/lib/providers.js");
        const { withRetry } = await import("../../src/lib/retry.js");
        const { createProvider } = await import("../../src/lib/providers/factory.js");

        vi.mocked(createProvider).mockReturnValue({ call: vi.fn().mockResolvedValue({ content: "stream-content" }) } as any);

        const config = { name: "test", type: "openai" } as any;
        const result = await askProviderStream(config, "hi", vi.fn());

        expect(result.content).toBe("stream-content");
        expect(withRetry).toHaveBeenCalled();
    });

    it("should handle fatal errors without retry if specified", async () => {
        const { askProviderStream } = await import("../../src/lib/providers.js");
        const { withRetry } = await import("../../src/lib/retry.js");
        
        vi.mocked(withRetry).mockRejectedValue(new Error("invalid type"));

        const config = { name: "test", type: "openai" } as any;
        await expect(askProviderStream(config, "hi", vi.fn())).rejects.toThrow(/invalid type/);
    });
  });
});
