import {
  acquireRefreshLock,
  releaseRefreshLock,
  withRefreshLock,
  RefreshTokenLockConflictError,
} from "../../lib/refreshTokenMutex.js";
import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("../../lib/redis.js", () => ({
  default: {
    set: vi.fn(),
    eval: vi.fn().mockResolvedValue(1),
  },
}));

describe("refreshTokenMutex", () => {
  beforeEach(() => vi.clearAllMocks());

  describe("acquireRefreshLock", () => {
    it("returns true when lock is acquired successfully", async () => {
      const { default: redis } = await import("../../lib/redis.js");
      (redis.set as ReturnType<typeof vi.fn>).mockResolvedValueOnce("OK");

      const result = await acquireRefreshLock("token-hash-abc", "request-id-1");
      expect(result).toBe(true);
    });

    it("throws RefreshTokenLockConflictError when lock is already held", async () => {
      const { default: redis } = await import("../../lib/redis.js");
      (redis.set as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null); // NX set returns null if key exists

      await expect(
        acquireRefreshLock("token-hash-abc", "request-id-2")
      ).rejects.toThrow(RefreshTokenLockConflictError);
    });

    it("fails open when Redis is unavailable", async () => {
      const { default: redis } = await import("../../lib/redis.js");
      (redis.set as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("Redis connection refused"));

      // Should NOT throw — fails open
      const result = await acquireRefreshLock("token-hash-abc", "request-id-3");
      expect(result).toBe(false);
    });
  });

  describe("releaseRefreshLock", () => {
    it("executes Lua script to release lock atomically", async () => {
      const { default: redis } = await import("../../lib/redis.js");

      await releaseRefreshLock("token-hash-abc", "request-id-1");

      expect((redis as unknown as { eval: ReturnType<typeof vi.fn> }).eval).toHaveBeenCalledOnce();
    });

    it("does not throw when release fails (non-critical)", async () => {
      const { default: redis } = await import("../../lib/redis.js");
      (redis as unknown as { eval: ReturnType<typeof vi.fn> }).eval.mockRejectedValueOnce(new Error("Network error"));

      await expect(
        releaseRefreshLock("token-hash-abc", "request-id-1")
      ).resolves.not.toThrow();
    });
  });

  describe("withRefreshLock", () => {
    it("executes callback while holding lock and releases after", async () => {
      const { default: redis } = await import("../../lib/redis.js");
      (redis.set as ReturnType<typeof vi.fn>).mockResolvedValueOnce("OK");

      let callbackRan = false;
      await withRefreshLock("token-hash-abc", "req-1", async () => {
        callbackRan = true;
        return "result";
      });

      expect(callbackRan).toBe(true);
      // Release should have been called
      expect((redis as unknown as { eval: ReturnType<typeof vi.fn> }).eval).toHaveBeenCalledOnce();
    });

    it("releases lock even when callback throws", async () => {
      const { default: redis } = await import("../../lib/redis.js");
      (redis.set as ReturnType<typeof vi.fn>).mockResolvedValueOnce("OK");

      await expect(
        withRefreshLock("token-hash-abc", "req-1", async () => {
          throw new Error("DB error during rotation");
        })
      ).rejects.toThrow("DB error");

      // Lock should still be released
      expect((redis as unknown as { eval: ReturnType<typeof vi.fn> }).eval).toHaveBeenCalledOnce();
    });

    it("propagates RefreshTokenLockConflictError when lock is contended", async () => {
      const { default: redis } = await import("../../lib/redis.js");
      (redis.set as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null); // lock held

      await expect(
        withRefreshLock("token-hash-abc", "req-2", async () => "never reached")
      ).rejects.toThrow(RefreshTokenLockConflictError);
    });
  });
});
