import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock all external deps before imports
vi.mock("../../src/lib/logger.js", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("passport-github2", () => ({
  Strategy: vi.fn().mockImplementation(function(this: unknown, _opts: unknown, verify: unknown) {
    (this as Record<string, unknown>).name = "github";
  }),
}));

const mockRegister = vi.fn().mockResolvedValue(undefined);
const mockGet = vi.fn();

function makeFastify(overrides: Record<string, unknown> = {}) {
  return {
    register: mockRegister,
    get: mockGet,
    post: vi.fn(),
    addHook: vi.fn(),
    ...overrides,
  };
}

vi.mock("../../src/lib/drizzle.js", () => ({
  db: {
    select: vi.fn().mockReturnValue({ from: vi.fn().mockReturnValue({ where: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([]) }) }) }),
    insert: vi.fn().mockReturnValue({ values: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([]) }) }),
  },
}));

vi.mock("../../src/db/schema/users.js", () => ({
  users: { id: "id", email: "email", username: "username" },
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((a, b) => ({ a, b })),
  or: vi.fn((...args) => args),
}));

vi.mock("../../src/config/env.js", () => ({
  env: {
    GITHUB_CLIENT_ID: "test-client-id",
    GITHUB_CLIENT_SECRET: "test-client-secret",
    OAUTH_CALLBACK_BASE_URL: "https://app.example.com",
    JWT_SECRET: "test-secret",
  },
}));

import { githubOAuthPlugin } from "../../src/auth/github.strategy.js";
import logger from "../../src/lib/logger.js";

describe("githubOAuthPlugin", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns early and logs info when GITHUB_CLIENT_ID is not set", async () => {
    // Override env to remove credentials
    const { env } = await import("../../src/config/env.js");
    const originalId = (env as Record<string, unknown>).GITHUB_CLIENT_ID;
    (env as Record<string, unknown>).GITHUB_CLIENT_ID = undefined;

    const fastify = makeFastify();
    await githubOAuthPlugin(fastify as unknown as Parameters<typeof githubOAuthPlugin>[0]);

    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining("GitHub OAuth disabled")
    );
    expect(mockRegister).not.toHaveBeenCalled();

    // Restore
    (env as Record<string, unknown>).GITHUB_CLIENT_ID = originalId;
  });

  it("registers the oauth plugin when credentials are present", async () => {
    const fastify = makeFastify();
    await githubOAuthPlugin(fastify as unknown as Parameters<typeof githubOAuthPlugin>[0]);

    expect(mockRegister).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        name: "githubOAuth2",
        scope: ["user:email"],
      })
    );
  });

  it("registers the callback route at /api/auth/github/callback", async () => {
    const fastify = makeFastify();
    await githubOAuthPlugin(fastify as unknown as Parameters<typeof githubOAuthPlugin>[0]);

    expect(mockGet).toHaveBeenCalledWith(
      "/api/auth/github/callback",
      expect.any(Function)
    );
  });

  it("configures callbackUri using OAUTH_CALLBACK_BASE_URL", async () => {
    const fastify = makeFastify();
    await githubOAuthPlugin(fastify as unknown as Parameters<typeof githubOAuthPlugin>[0]);

    const registrationOptions = mockRegister.mock.calls[0][1];
    expect(registrationOptions.callbackUri).toContain("https://app.example.com");
    expect(registrationOptions.callbackUri).toContain("/api/auth/github/callback");
  });

  describe("generateStateFunction", () => {
    it("returns a 64-character hex string", async () => {
      const fastify = makeFastify();
      await githubOAuthPlugin(fastify as unknown as Parameters<typeof githubOAuthPlugin>[0]);

      const opts = mockRegister.mock.calls[0][1];
      const state = opts.generateStateFunction({});
      expect(state).toMatch(/^[0-9a-f]{64}$/);
    });

    it("generates unique states on each call", async () => {
      const fastify = makeFastify();
      await githubOAuthPlugin(fastify as unknown as Parameters<typeof githubOAuthPlugin>[0]);

      const opts = mockRegister.mock.calls[0][1];
      const state1 = opts.generateStateFunction({});
      const state2 = opts.generateStateFunction({});
      expect(state1).not.toBe(state2);
    });
  });

  describe("checkStateFunction", () => {
    it("calls callback without error for valid 64-char hex state", async () => {
      const fastify = makeFastify();
      await githubOAuthPlugin(fastify as unknown as Parameters<typeof githubOAuthPlugin>[0]);

      const opts = mockRegister.mock.calls[0][1];
      const validState = "a".repeat(64);
      const cb = vi.fn();
      opts.checkStateFunction(validState, cb);
      expect(cb).toHaveBeenCalledWith(); // no error
    });

    it("calls callback with error for malformed state (too short)", async () => {
      const fastify = makeFastify();
      await githubOAuthPlugin(fastify as unknown as Parameters<typeof githubOAuthPlugin>[0]);

      const opts = mockRegister.mock.calls[0][1];
      const badState = "short";
      const cb = vi.fn();
      opts.checkStateFunction(badState, cb);
      expect(cb).toHaveBeenCalledWith(expect.any(Error));
      expect((cb.mock.calls[0][0] as Error).message).toContain("Invalid OAuth state");
    });

    it("calls callback with error for empty state", async () => {
      const fastify = makeFastify();
      await githubOAuthPlugin(fastify as unknown as Parameters<typeof githubOAuthPlugin>[0]);

      const opts = mockRegister.mock.calls[0][1];
      const cb = vi.fn();
      opts.checkStateFunction("", cb);
      expect(cb).toHaveBeenCalledWith(expect.any(Error));
    });

    it("calls callback with error for non-hex state of correct length", async () => {
      const fastify = makeFastify();
      await githubOAuthPlugin(fastify as unknown as Parameters<typeof githubOAuthPlugin>[0]);

      const opts = mockRegister.mock.calls[0][1];
      const nonHexState = "Z".repeat(64); // Z is not valid hex
      const cb = vi.fn();
      opts.checkStateFunction(nonHexState, cb);
      expect(cb).toHaveBeenCalledWith(expect.any(Error));
    });
  });
});
