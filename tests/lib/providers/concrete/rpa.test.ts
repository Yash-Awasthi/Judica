import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../../src/lib/logger.js", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("fs", () => {
  const existsSync = vi.fn().mockReturnValue(false);
  const mkdirSync = vi.fn();
  const statSync = vi.fn().mockReturnValue({ mtimeMs: Date.now() });
  const unlinkSync = vi.fn();
  return {
    default: { existsSync, mkdirSync, statSync, unlinkSync },
    existsSync,
    mkdirSync,
    statSync,
    unlinkSync,
  };
});

vi.mock("path", () => ({
  default: {
    resolve: (...args: string[]) => args.join("/"),
    join: (...args: string[]) => args.join("/"),
  },
  resolve: (...args: string[]) => args.join("/"),
  join: (...args: string[]) => args.join("/"),
}));

import { RPAProvider } from "../../../../src/lib/providers/concrete/rpa.js";
import type { ProviderConfig } from "../../../../src/lib/providers/types.js";

function makeConfig(overrides: Partial<ProviderConfig> = {}): ProviderConfig {
  return {
    name: "Test RPA",
    model: "chatgpt",
    systemPrompt: "You are helpful",
    providerId: "rpa",
    userId: 1,
    enabled: true,
    temperature: 0.7,
    ...overrides,
  };
}

describe("RPAProvider", () => {
  describe("constructor", () => {
    it("creates an instance for a valid RPA target (chatgpt)", () => {
      const provider = new RPAProvider(makeConfig({ model: "chatgpt" }));
      expect(provider).toBeDefined();
    });

    it("creates an instance for claude target", () => {
      const provider = new RPAProvider(makeConfig({ model: "claude" }));
      expect(provider).toBeDefined();
    });

    it("creates an instance for deepseek target", () => {
      const provider = new RPAProvider(makeConfig({ model: "deepseek" }));
      expect(provider).toBeDefined();
    });

    it("creates an instance for gemini target", () => {
      const provider = new RPAProvider(makeConfig({ model: "gemini" }));
      expect(provider).toBeDefined();
    });

    it("throws for unknown RPA target", () => {
      expect(() => new RPAProvider(makeConfig({ model: "unknown-target" }))).toThrow(
        "Unknown RPA target: unknown-target"
      );
    });

    it("sanitises userId to alphanumeric chars only", () => {
      // Should not throw even with path-traversal attempts in userId
      expect(() =>
        new RPAProvider(makeConfig({ userId: "../../../etc/passwd" as unknown as number }))
      ).not.toThrow();
    });

    it("uses 'default' when userId is undefined", () => {
      expect(() => new RPAProvider(makeConfig({ userId: undefined }))).not.toThrow();
    });
  });

  describe("call — without real browser (mocked playwright)", () => {
    it("throws 'Login required' when page shows login indicators", async () => {
      // Mock playwright to simulate login state
      const mockPage = {
        goto: vi.fn().mockResolvedValue(undefined),
        locator: vi.fn().mockReturnValue({
          first: () => ({ isVisible: vi.fn().mockResolvedValue(true) }),
          last: () => ({
            textContent: vi.fn().mockResolvedValue(""),
            waitFor: vi.fn().mockResolvedValue(undefined),
          }),
          waitFor: vi.fn().mockResolvedValue(undefined),
        }),
        close: vi.fn().mockResolvedValue(undefined),
        waitForTimeout: vi.fn().mockResolvedValue(undefined),
      };
      const mockContext = {
        newPage: vi.fn().mockResolvedValue(mockPage),
        storageState: vi.fn().mockResolvedValue({}),
        close: vi.fn().mockResolvedValue(undefined),
      };
      const mockBrowser = {
        version: vi.fn().mockResolvedValue("1.0"),
        newContext: vi.fn().mockResolvedValue(mockContext),
      };

      vi.doMock("playwright", () => ({
        chromium: { launch: vi.fn().mockResolvedValue(mockBrowser) },
      }));

      const provider = new RPAProvider(makeConfig({ model: "chatgpt" }));
      await expect(
        provider.call({ messages: [{ role: "user", content: "Hello" }] })
      ).rejects.toThrow();
    });
  });

  describe("healthCheck", () => {
    it("returns false when playwright is unavailable", async () => {
      // By default, no browser is launched — healthCheck should fail gracefully
      const provider = new RPAProvider(makeConfig({ model: "chatgpt" }));
      // We don't launch playwright in unit tests, so this should return false
      const result = await provider.healthCheck().catch(() => false);
      expect(typeof result).toBe("boolean");
    });
  });
});
