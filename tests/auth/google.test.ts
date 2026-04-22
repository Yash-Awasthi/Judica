import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock passport-google-oauth20 - must be a real class since source uses `new`
let capturedVerify: any;
vi.mock("passport-google-oauth20", () => {
  const MockStrategy = vi.fn().mockImplementation(function (this: any, _opts: any, verify: any) {
    this.name = "google";
    this._verify = verify;
    capturedVerify = verify;
  });
  return { Strategy: MockStrategy };
});

// Mock drizzle db
const mockFrom = vi.fn();
const mockWhere = vi.fn();
const mockLimit = vi.fn();
const mockValues = vi.fn();
const mockReturning = vi.fn();

const mockOnConflictDoNothing = vi.fn();

vi.mock("../../src/lib/drizzle.js", () => ({
  db: {
    select: () => ({ from: mockFrom }),
    insert: () => ({ values: mockValues }),
  },
}));

mockFrom.mockReturnValue({ where: mockWhere });
mockWhere.mockReturnValue({ limit: mockLimit });
mockValues.mockReturnValue({ returning: mockReturning, onConflictDoNothing: mockOnConflictDoNothing });
mockOnConflictDoNothing.mockReturnValue({ returning: mockReturning });

vi.mock("../../src/db/schema/users.js", () => ({
  users: { email: "email" },
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((a: any, b: any) => ({ field: a, value: b })),
}));

vi.mock("../../src/config/env.js", () => ({
  env: {
    GOOGLE_CLIENT_ID: "test-google-id",
    GOOGLE_CLIENT_SECRET: "test-google-secret",
    OAUTH_CALLBACK_BASE_URL: "http://localhost:3000",
  },
}));

import { createGoogleStrategy } from "../../src/auth/google.strategy.js";
import { Strategy as GoogleStrategy } from "passport-google-oauth20";

describe("createGoogleStrategy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFrom.mockReturnValue({ where: mockWhere });
    mockWhere.mockReturnValue({ limit: mockLimit });
    mockValues.mockReturnValue({ returning: mockReturning, onConflictDoNothing: mockOnConflictDoNothing });
    mockOnConflictDoNothing.mockReturnValue({ returning: mockReturning });
  });

  it("returns a strategy when credentials are configured", () => {
    const strategy = createGoogleStrategy();
    expect(strategy).not.toBeNull();
    expect(GoogleStrategy).toHaveBeenCalledWith(
      expect.objectContaining({
        clientID: "test-google-id",
        clientSecret: "test-google-secret",
        callbackURL: "http://localhost:3000/api/auth/google/callback",
      }),
      expect.any(Function)
    );
  });

  it("calls done with error when no email is provided", async () => {
    const strategy = createGoogleStrategy() as any;
    const verify = strategy._verify;
    const done = vi.fn();

    await verify("token", "refresh", { emails: [] }, done);
    expect(done).toHaveBeenCalledWith(expect.any(Error));
    expect(done.mock.calls[0][0].message).toContain("No email from Google");
  });

  it("calls done with error when email is not verified", async () => {
    const strategy = createGoogleStrategy() as any;
    const verify = strategy._verify;
    const done = vi.fn();

    await verify("token", "refresh", {
      emails: [{ value: "test@example.com", verified: false }],
    }, done);

    expect(done).toHaveBeenCalledWith(expect.any(Error));
    expect(done.mock.calls[0][0].message).toContain("not verified");
  });

  it("returns existing OAuth user", async () => {
    const existingUser = { id: 1, email: "test@example.com", authMethod: "google", role: "member" };
    mockLimit.mockResolvedValueOnce([existingUser]);

    const strategy = createGoogleStrategy() as any;
    const verify = strategy._verify;
    const done = vi.fn();

    await verify("token", "refresh", {
      emails: [{ value: "test@example.com", verified: true }],
    }, done);

    expect(done).toHaveBeenCalledWith(null, existingUser);
  });

  it("rejects login when existing user has password (different method)", async () => {
    const existingUser = { id: 1, email: "test@example.com", authMethod: "password", role: "member" };
    mockLimit.mockResolvedValueOnce([existingUser]);

    const strategy = createGoogleStrategy() as any;
    const verify = strategy._verify;
    const done = vi.fn();

    await verify("token", "refresh", {
      emails: [{ value: "test@example.com", verified: true }],
    }, done);

    expect(done).toHaveBeenCalledWith(expect.any(Error));
    expect(done.mock.calls[0][0].message).toContain("different sign-in method");
  });

  it("creates a new user when none exists", async () => {
    mockLimit.mockResolvedValueOnce([]);
    const newUser = { id: 2, email: "new@example.com", username: "New User", role: "member" };
    mockReturning.mockResolvedValueOnce([newUser]);

    const strategy = createGoogleStrategy() as any;
    const verify = strategy._verify;
    const done = vi.fn();

    await verify("token", "refresh", {
      emails: [{ value: "new@example.com", verified: true }],
      displayName: "New User",
    }, done);

    expect(done).toHaveBeenCalledWith(null, newUser);
  });

  it("falls back to email prefix for username when displayName is absent", async () => {
    mockLimit.mockResolvedValueOnce([]);
    const newUser = { id: 3, email: "user@example.com", username: "user", role: "member" };
    mockReturning.mockResolvedValueOnce([newUser]);

    const strategy = createGoogleStrategy() as any;
    const verify = strategy._verify;
    const done = vi.fn();

    await verify("token", "refresh", {
      emails: [{ value: "user@example.com", verified: true }],
    }, done);

    expect(done).toHaveBeenCalledWith(null, newUser);
  });

  it("calls done with error when DB fails", async () => {
    mockLimit.mockRejectedValueOnce(new Error("DB connection lost"));

    const strategy = createGoogleStrategy() as any;
    const verify = strategy._verify;
    const done = vi.fn();

    await verify("token", "refresh", {
      emails: [{ value: "test@example.com", verified: true }],
    }, done);

    expect(done).toHaveBeenCalledWith(expect.any(Error));
    expect(done.mock.calls[0][0].message).toBe("DB connection lost");
  });
});
