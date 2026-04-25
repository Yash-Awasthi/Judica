import { describe, it, expect } from "vitest";
import { env } from "../../src/config/env.js";

describe("env config", () => {
  it("should export parsed env with test values", () => {
    expect(env.NODE_ENV).toBe("test");
    expect(env.DATABASE_URL).toBe("postgresql://test:test@localhost:5432/test");
    expect(env.JWT_SECRET).toBe("test-jwt-secret-that-is-at-least-32-characters-long-for-validation");
    expect(env.MASTER_ENCRYPTION_KEY).toBe("0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef");
  });

  it("should apply defaults", () => {
    expect(env.PORT).toBe(3000);
    expect(env.REDIS_URL).toBeDefined();
    expect(env.OLLAMA_BASE_URL).toBe("http://localhost:11434");
  });
});
