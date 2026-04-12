import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/lib/logger.js", () => ({
  default: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("../../src/router/quotaTracker.js", () => ({
  canUse: vi.fn(),
}));

vi.mock("../../src/router/rpmLimiter.js", () => ({
  checkRPM: vi.fn(),
}));

vi.mock("../../src/adapters/registry.js", () => ({
  hasAdapter: vi.fn(),
}));

import { selectProvider, getChainEntry, FREE_TIER_CHAIN, PAID_CHAIN, type ChainEntry } from "../../src/router/providerChain.js";
import { canUse } from "../../src/router/quotaTracker.js";
import { checkRPM } from "../../src/router/rpmLimiter.js";
import { hasAdapter } from "../../src/adapters/registry.js";

const mockedCanUse = vi.mocked(canUse);
const mockedCheckRPM = vi.mocked(checkRPM);
const mockedHasAdapter = vi.mocked(hasAdapter);

describe("providerChain", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe("FREE_TIER_CHAIN", () => {
    it("should contain at least 3 entries", () => {
      expect(FREE_TIER_CHAIN.length).toBeGreaterThanOrEqual(3);
    });

    it("should have gemini as the first entry", () => {
      expect(FREE_TIER_CHAIN[0].provider).toBe("gemini");
    });

    it("should have valid structure on all entries", () => {
      for (const entry of FREE_TIER_CHAIN) {
        expect(entry.provider).toBeTruthy();
        expect(entry.model).toBeTruthy();
        expect(entry.rpm).toBeGreaterThan(0);
        expect(entry.daily_tokens).toBeGreaterThan(0);
        expect(entry.daily_requests).toBeGreaterThan(0);
      }
    });
  });

  describe("PAID_CHAIN", () => {
    it("should contain at least 2 entries", () => {
      expect(PAID_CHAIN.length).toBeGreaterThanOrEqual(2);
    });

    it("should have openai as the first entry", () => {
      expect(PAID_CHAIN[0].provider).toBe("openai");
    });
  });

  describe("selectProvider", () => {
    const testChain: ChainEntry[] = [
      { provider: "alpha", model: "alpha-v1", rpm: 10, daily_tokens: 100000, daily_requests: 100 },
      { provider: "beta", model: "beta-v1", rpm: 20, daily_tokens: 200000, daily_requests: 200 },
      { provider: "gamma", model: "gamma-v1", rpm: 30, daily_tokens: 300000, daily_requests: 300 },
    ];

    it("should return the first available provider", () => {
      mockedHasAdapter.mockReturnValue(true);
      mockedCanUse.mockReturnValue(true);
      mockedCheckRPM.mockReturnValue(true);

      const result = selectProvider(100, testChain);
      expect(result).toEqual({ provider: "alpha", model: "alpha-v1" });
    });

    it("should skip providers without a registered adapter", () => {
      mockedHasAdapter.mockImplementation((id) => id !== "alpha");
      mockedCanUse.mockReturnValue(true);
      mockedCheckRPM.mockReturnValue(true);

      const result = selectProvider(100, testChain);
      expect(result).toEqual({ provider: "beta", model: "beta-v1" });
    });

    it("should skip providers that exceeded daily quota", () => {
      mockedHasAdapter.mockReturnValue(true);
      mockedCanUse.mockImplementation((provider) => provider !== "alpha");
      mockedCheckRPM.mockReturnValue(true);

      const result = selectProvider(100, testChain);
      expect(result).toEqual({ provider: "beta", model: "beta-v1" });
    });

    it("should skip providers that exceeded RPM limit", () => {
      mockedHasAdapter.mockReturnValue(true);
      mockedCanUse.mockReturnValue(true);
      mockedCheckRPM.mockImplementation((provider) => provider !== "alpha");

      const result = selectProvider(100, testChain);
      expect(result).toEqual({ provider: "beta", model: "beta-v1" });
    });

    it("should return null when all providers are exhausted", () => {
      mockedHasAdapter.mockReturnValue(false);

      const result = selectProvider(100, testChain);
      expect(result).toBeNull();
    });

    it("should return null for empty chain", () => {
      const result = selectProvider(100, []);
      expect(result).toBeNull();
    });

    it("should fall through to last provider when others are unavailable", () => {
      mockedHasAdapter.mockImplementation((id) => id === "gamma");
      mockedCanUse.mockReturnValue(true);
      mockedCheckRPM.mockReturnValue(true);

      const result = selectProvider(100, testChain);
      expect(result).toEqual({ provider: "gamma", model: "gamma-v1" });
    });

    it("should pass correct limits to canUse and checkRPM", () => {
      mockedHasAdapter.mockReturnValue(true);
      mockedCanUse.mockReturnValue(true);
      mockedCheckRPM.mockReturnValue(true);

      selectProvider(500, testChain);

      expect(mockedCanUse).toHaveBeenCalledWith("alpha", 100, 100000);
      expect(mockedCheckRPM).toHaveBeenCalledWith("alpha", 10);
    });
  });

  describe("getChainEntry", () => {
    it("should find an entry in the default combined chain", () => {
      const entry = getChainEntry("gemini");
      expect(entry).toBeDefined();
      expect(entry!.provider).toBe("gemini");
    });

    it("should return undefined for unknown provider", () => {
      expect(getChainEntry("nonexistent")).toBeUndefined();
    });

    it("should search a custom chain when provided", () => {
      const custom: ChainEntry[] = [
        { provider: "custom", model: "c-v1", rpm: 5, daily_tokens: 1000, daily_requests: 10 },
      ];
      const entry = getChainEntry("custom", custom);
      expect(entry).toBeDefined();
      expect(entry!.model).toBe("c-v1");
    });

    it("should return undefined if provider not in custom chain", () => {
      const custom: ChainEntry[] = [
        { provider: "custom", model: "c-v1", rpm: 5, daily_tokens: 1000, daily_requests: 10 },
      ];
      expect(getChainEntry("gemini", custom)).toBeUndefined();
    });
  });
});
