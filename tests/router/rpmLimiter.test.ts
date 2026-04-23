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

  // ── userId scoping ──────────────────────────────────────────────────────────

  describe("userId scoping", () => {
    it("tracks per-user RPM independently from global provider RPM", () => {
      recordRequest(provider, "user-A");
      recordRequest(provider, "user-A");
      recordRequest(provider, "user-B");

      expect(getCurrentRPM(provider, "user-A")).toBe(2);
      expect(getCurrentRPM(provider, "user-B")).toBe(1);
      // Global provider (no userId) is unaffected
      expect(getCurrentRPM(provider)).toBe(0);
    });

    it("checkRPM with userId uses user-scoped window", () => {
      for (let i = 0; i < 5; i++) recordRequest(provider, "user-X");
      expect(checkRPM(provider, 5, "user-X")).toBe(false);
      expect(checkRPM(provider, 5, "user-Y")).toBe(true); // Y has 0 requests
    });

    it("records and checks without userId use the provider-level key", () => {
      recordRequest(provider);
      expect(getCurrentRPM(provider)).toBe(1);
      expect(getCurrentRPM(provider, undefined)).toBe(1);
    });
  });

  // ── sliding window compaction ───────────────────────────────────────────────

  describe("sliding window compaction", () => {
    it("compacts internal array when start pointer exceeds 512 and > half of array", () => {
      const realNow = Date.now;
      const baseTime = 1_000_000;

      // Insert 600 expired timestamps so start will advance past 512
      Date.now = () => baseTime;
      for (let i = 0; i < 600; i++) recordRequest(provider);

      // Advance time so all 600 are expired
      Date.now = () => baseTime + 61_000;

      // Add one fresh request to trigger prune (start will advance to 600)
      recordRequest(provider);

      // getCurrentRPM prunes and should compact when start(=600) > 512 and > length/2
      const rpm = getCurrentRPM(provider);
      // Only the 1 fresh request should remain in the active window
      expect(rpm).toBe(1);

      Date.now = realNow;
    });

    it("does not compact when start is ≤ 512", () => {
      const realNow = Date.now;
      const baseTime = 2_000_000;

      Date.now = () => baseTime;
      // Only 10 expired entries — start will advance to 10, below 512 threshold
      for (let i = 0; i < 10; i++) recordRequest(provider);

      Date.now = () => baseTime + 61_000;
      recordRequest(provider); // fresh

      const rpm = getCurrentRPM(provider);
      expect(rpm).toBe(1);

      Date.now = realNow;
    });
  });
});
