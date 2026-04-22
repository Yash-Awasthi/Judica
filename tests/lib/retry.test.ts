import { describe, it, expect, vi } from "vitest";
import { withRetry } from "../../src/lib/retry.js";

describe("Retry Utility", () => {
  it("should return value on first attempt if successful", async () => {
    const fn = vi.fn().mockResolvedValue("success");
    const result = await withRetry(fn);
    expect(result).toBe("success");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("should retry on failure up to maxRetries", async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error("fail1"))
      .mockRejectedValueOnce(new Error("fail2"))
      .mockResolvedValue("success");

    const onRetry = vi.fn();
    
    const result = await withRetry(fn, { maxRetries: 2, initialDelay: 1, onRetry });
    
    expect(result).toBe("success");
    expect(fn).toHaveBeenCalledTimes(3);
    expect(onRetry).toHaveBeenCalledTimes(4);
  });

  it("should throw after exhausting retries", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("permanent fail"));
    
    const promise = withRetry(fn, { maxRetries: 1, initialDelay: 1 });
    
    await expect(promise).rejects.toThrow("permanent fail");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("should not retry on AbortError", async () => {
    const abortError = new Error("aborted");
    abortError.name = "AbortError";
    const fn = vi.fn().mockRejectedValue(abortError);
    
    const promise = withRetry(fn, { maxRetries: 5, initialDelay: 1 });
    await expect(promise).rejects.toThrow("aborted");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("should respect shouldRetry condition", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("specific fail"));
    const shouldRetry = vi.fn().mockReturnValue(false);
    
    const promise = withRetry(fn, { shouldRetry, initialDelay: 1 });
    await expect(promise).rejects.toThrow("specific fail");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("should respect maxDelay", async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error("fail"))
      .mockRejectedValueOnce(new Error("fail"))
      .mockResolvedValue("ok");

    // initial 1, factor 10 -> 10 next, max limit 5
    const promise = withRetry(fn, { 
      initialDelay: 1, 
      factor: 10, 
      maxDelay: 5 
    });

    const res = await promise;
    expect(res).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(3);
  });
});
