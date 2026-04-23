import { describe, it, expect } from "vitest";
import { validateTtl } from "../../../src/lib/cache/CacheBackend.js";

describe("CacheBackend — validateTtl", () => {
  it("does not throw for valid positive TTL", () => {
    expect(() => validateTtl(1000)).not.toThrow();
    expect(() => validateTtl(1)).not.toThrow();
    expect(() => validateTtl(86_400_000)).not.toThrow();
  });

  it("throws RangeError for ttlMs = 0", () => {
    expect(() => validateTtl(0)).toThrowError(RangeError);
    expect(() => validateTtl(0)).toThrow("Invalid TTL: 0ms");
  });

  it("throws RangeError for negative TTL", () => {
    expect(() => validateTtl(-1)).toThrowError(RangeError);
    expect(() => validateTtl(-1000)).toThrow("must be a positive finite number");
  });

  it("throws RangeError for NaN", () => {
    expect(() => validateTtl(NaN)).toThrowError(RangeError);
  });

  it("throws RangeError for Infinity", () => {
    expect(() => validateTtl(Infinity)).toThrowError(RangeError);
  });

  it("throws RangeError for -Infinity", () => {
    expect(() => validateTtl(-Infinity)).toThrowError(RangeError);
  });

  it("accepts fractional milliseconds (e.g. 0.5ms)", () => {
    // 0.5 > 0 and is finite — should be valid
    expect(() => validateTtl(0.5)).not.toThrow();
  });
});
