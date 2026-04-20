import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../../src/lib/logger.js", () => ({
  default: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import {
  canUse,
  recordUsage,
  getRemainingQuota,
  resetQuota,
  getAllQuotas,
} from "../../src/router/quotaTracker.js";

describe("quotaTracker", () => {
  let provider: string;
  let counter = 0;

  beforeEach(() => {
    // Use unique provider names to avoid cross-test pollution
    provider = `qt-provider-${++counter}-${Date.now()}`;
  });

  describe("canUse", () => {
    it("should return true for a fresh provider with default (Infinity) limits", () => {
      expect(canUse(provider)).toBe(true);
    });

    it("should return true when under both limits", () => {
      recordUsage(provider, 100);
      expect(canUse(provider, 10, 1000)).toBe(true);
    });

    it("should return false when daily requests exceeded", () => {
      recordUsage(provider, 10);
      recordUsage(provider, 10);
      recordUsage(provider, 10);
      // 3 requests used, limit is 3
      expect(canUse(provider, 3, 999999)).toBe(false);
    });

    it("should return false when daily tokens exceeded", () => {
      recordUsage(provider, 500);
      recordUsage(provider, 600);
      // 1100 tokens used, limit is 1000
      expect(canUse(provider, 999, 1000)).toBe(false);
    });
  });

  describe("recordUsage", () => {
    it("should increment request count and token count", () => {
      recordUsage(provider, 50);
      const status = getRemainingQuota(provider, 10, 1000);
      expect(status.requests_used).toBe(1);
      expect(status.tokens_used).toBe(50);
    });

    it("should accumulate across multiple calls", () => {
      recordUsage(provider, 100);
      recordUsage(provider, 200);
      recordUsage(provider, 300);
      const status = getRemainingQuota(provider, 100, 100000);
      expect(status.requests_used).toBe(3);
      expect(status.tokens_used).toBe(600);
    });
  });

  describe("getRemainingQuota", () => {
    it("should report full quota for fresh provider", () => {
      const status = getRemainingQuota(provider, 100, 5000);
      expect(status.requests_used).toBe(0);
      expect(status.tokens_used).toBe(0);
      expect(status.requests_remaining).toBe(100);
      expect(status.tokens_remaining).toBe(5000);
    });

    it("should compute remaining correctly", () => {
      recordUsage(provider, 1000);
      recordUsage(provider, 500);
      const status = getRemainingQuota(provider, 10, 5000);
      expect(status.requests_used).toBe(2);
      expect(status.tokens_used).toBe(1500);
      expect(status.requests_remaining).toBe(8);
      expect(status.tokens_remaining).toBe(3500);
    });

    it("should clamp remaining to 0 when over quota", () => {
      recordUsage(provider, 3000);
      recordUsage(provider, 3000);
      const status = getRemainingQuota(provider, 1, 5000);
      expect(status.requests_remaining).toBe(0);
      expect(status.tokens_remaining).toBe(0);
    });

    it("should use Infinity defaults", () => {
      recordUsage(provider, 100);
      const status = getRemainingQuota(provider);
      expect(status.requests_remaining).toBe(Infinity);
      expect(status.tokens_remaining).toBe(Infinity);
    });
  });

  describe("resetQuota", () => {
    it("should clear usage for a provider", () => {
      recordUsage(provider, 500);
      expect(getRemainingQuota(provider, 10, 1000).requests_used).toBe(1);
      resetQuota(provider, undefined, true);
      expect(getRemainingQuota(provider, 10, 1000).requests_used).toBe(0);
    });

    it("should be safe to call on unknown provider", () => {
      expect(() => resetQuota("nonexistent", undefined, true)).not.toThrow();
    });
  });

  describe("getAllQuotas", () => {
    it("should return an object with all tracked providers", () => {
      recordUsage(provider, 100);
      const all = getAllQuotas();
      expect(all[provider]).toBeDefined();
      expect(all[provider].requests_used).toBe(1);
      expect(all[provider].tokens_used).toBe(100);
    });

    it("should return copies (not references)", () => {
      recordUsage(provider, 50);
      const all = getAllQuotas();
      all[provider].requests_used = 999;
      // Original should be unchanged
      const fresh = getAllQuotas();
      expect(fresh[provider].requests_used).toBe(1);
    });
  });
});
