import { describe, it, expect, beforeEach, vi } from "vitest";

// rpmLimiter uses Date.now() internally. We use vi.spyOn to control time.

import { checkRPM, recordRequest, getCurrentRPM } from "../../src/router/rpmLimiter.js";

describe("rpmLimiter", () => {
  // Each test uses a unique provider name to avoid cross-test pollution
  // (the module keeps a global Map).
  let provider: string;
  let counter = 0;

  beforeEach(() => {
    provider = `test-provider-${++counter}-${Date.now()}`;
  });

  describe("checkRPM", () => {
    it("should return true when no requests have been made", () => {
      expect(checkRPM(provider, 10)).toBe(true);
    });

    it("should return true when under the limit", () => {
      recordRequest(provider);
      recordRequest(provider);
      expect(checkRPM(provider, 5)).toBe(true);
    });

    it("should return false when at the limit", () => {
      for (let i = 0; i < 3; i++) recordRequest(provider);
      expect(checkRPM(provider, 3)).toBe(false);
    });

    it("should return false when over the limit", () => {
      for (let i = 0; i < 5; i++) recordRequest(provider);
      expect(checkRPM(provider, 3)).toBe(false);
    });

    it("should allow requests again after 60s window passes", () => {
      const realNow = Date.now;
      const baseTime = Date.now();

      // Record 3 requests at base time
      Date.now = () => baseTime;
      for (let i = 0; i < 3; i++) recordRequest(provider);
      expect(checkRPM(provider, 3)).toBe(false);

      // Advance time by 61 seconds
      Date.now = () => baseTime + 61_000;
      expect(checkRPM(provider, 3)).toBe(true);

      Date.now = realNow;
    });
  });

  describe("recordRequest", () => {
    it("should increase the RPM count", () => {
      expect(getCurrentRPM(provider)).toBe(0);
      recordRequest(provider);
      expect(getCurrentRPM(provider)).toBe(1);
      recordRequest(provider);
      expect(getCurrentRPM(provider)).toBe(2);
    });
  });

  describe("getCurrentRPM", () => {
    it("should return 0 for unknown provider", () => {
      expect(getCurrentRPM("nonexistent-provider-xyz")).toBe(0);
    });

    it("should prune old entries", () => {
      const realNow = Date.now;
      const baseTime = Date.now();

      Date.now = () => baseTime;
      recordRequest(provider);
      recordRequest(provider);

      // Advance 61s — old entries should be pruned
      Date.now = () => baseTime + 61_000;
      expect(getCurrentRPM(provider)).toBe(0);

      Date.now = realNow;
    });

    it("should keep recent entries", () => {
      const realNow = Date.now;
      const baseTime = Date.now();

      Date.now = () => baseTime;
      recordRequest(provider);

      // Only 30s later — still within window
      Date.now = () => baseTime + 30_000;
      recordRequest(provider);
      expect(getCurrentRPM(provider)).toBe(2);

      Date.now = realNow;
    });
  });
});
