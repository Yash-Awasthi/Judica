import { describe, it, expect } from "vitest";
import { DAILY_REQUEST_LIMIT, DAILY_TOKEN_LIMIT } from "../../src/config/quotas.js";

describe("quotas", () => {
  it("DAILY_REQUEST_LIMIT should be 100", () => {
    expect(DAILY_REQUEST_LIMIT).toBe(100);
  });

  it("DAILY_TOKEN_LIMIT should be 1,000,000", () => {
    expect(DAILY_TOKEN_LIMIT).toBe(1_000_000);
  });
});
