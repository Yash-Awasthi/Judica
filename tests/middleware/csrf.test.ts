import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Must set env before importing the module
const originalEnv = { ...process.env };

describe("fastifyCsrfProtection", () => {
  let fastifyCsrfProtection: typeof import("../../src/middleware/csrf.js").fastifyCsrfProtection;

  function createRequest(overrides: any = {}): any {
    return {
      method: "GET",
      headers: {},
      cookies: {},
      ...overrides,
    };
  }

  function createReply(): any {
    const reply: any = {
      statusCode: 200,
      code: vi.fn(function (this: any, c: number) {
        this.statusCode = c;
        return this;
      }),
      send: vi.fn(function (this: any) {
        return this;
      }),
    };
    return reply;
  }

  beforeEach(async () => {
    vi.resetModules();
    delete process.env.ALLOWED_ORIGINS;
    const mod = await import("../../src/middleware/csrf.js");
    fastifyCsrfProtection = mod.fastifyCsrfProtection;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  // ---- Safe methods pass through ----

  it("allows GET requests through without checks", async () => {
    const request = createRequest({ method: "GET" });
    const reply = createReply();
    await fastifyCsrfProtection(request, reply);
    expect(reply.code).not.toHaveBeenCalled();
    expect(reply.send).not.toHaveBeenCalled();
  });

  it("allows HEAD requests through without checks", async () => {
    const request = createRequest({ method: "HEAD" });
    const reply = createReply();
    await fastifyCsrfProtection(request, reply);
    expect(reply.code).not.toHaveBeenCalled();
  });

  it("allows OPTIONS requests through without checks", async () => {
    const request = createRequest({ method: "OPTIONS" });
    const reply = createReply();
    await fastifyCsrfProtection(request, reply);
    expect(reply.code).not.toHaveBeenCalled();
  });

  // ---- Bearer auth bypasses CSRF ----

  it("allows POST with Bearer auth header (no cookie)", async () => {
    const request = createRequest({
      method: "POST",
      headers: { authorization: "Bearer some-token" },
      cookies: {},
    });
    const reply = createReply();
    await fastifyCsrfProtection(request, reply);
    expect(reply.code).not.toHaveBeenCalled();
  });

  it("does not block when no cookie present (Bearer only)", async () => {
    const request = createRequest({
      method: "DELETE",
      headers: { authorization: "Bearer abc123" },
    });
    const reply = createReply();
    await fastifyCsrfProtection(request, reply);
    expect(reply.code).not.toHaveBeenCalled();
  });

  // ---- Cookie auth enforcement ----

  it("blocks POST with cookie auth but no X-Requested-With header (403)", async () => {
    const request = createRequest({
      method: "POST",
      headers: {},
      cookies: { access_token: "session-token" },
    });
    const reply = createReply();
    await fastifyCsrfProtection(request, reply);
    expect(reply.code).toHaveBeenCalledWith(403);
    expect(reply.send).toHaveBeenCalledWith({
      error: "CSRF validation failed. Include X-Requested-With header.",
    });
  });

  it("allows POST with cookie auth AND X-Requested-With header", async () => {
    const request = createRequest({
      method: "POST",
      headers: { "x-requested-with": "XMLHttpRequest" },
      cookies: { access_token: "session-token" },
    });
    const reply = createReply();
    await fastifyCsrfProtection(request, reply);
    expect(reply.code).not.toHaveBeenCalled();
  });

  // ---- Origin validation ----

  it("blocks POST with cookie auth when Origin is from attacker domain (403)", async () => {
    const request = createRequest({
      method: "POST",
      headers: {
        "x-requested-with": "XMLHttpRequest",
        origin: "https://evil.example.com",
      },
      cookies: { access_token: "session-token" },
    });
    const reply = createReply();
    await fastifyCsrfProtection(request, reply);
    expect(reply.code).toHaveBeenCalledWith(403);
    expect(reply.send).toHaveBeenCalledWith({
      error: "CSRF validation failed. Origin not allowed.",
    });
  });

  it("allows POST when Origin is localhost", async () => {
    const request = createRequest({
      method: "POST",
      headers: {
        "x-requested-with": "XMLHttpRequest",
        origin: "http://localhost:8080",
      },
      cookies: { access_token: "session-token" },
    });
    const reply = createReply();
    await fastifyCsrfProtection(request, reply);
    expect(reply.code).not.toHaveBeenCalled();
  });

  it("allows POST when Origin is 127.0.0.1", async () => {
    const request = createRequest({
      method: "POST",
      headers: {
        "x-requested-with": "XMLHttpRequest",
        origin: "http://127.0.0.1:3000",
      },
      cookies: { access_token: "session-token" },
    });
    const reply = createReply();
    await fastifyCsrfProtection(request, reply);
    expect(reply.code).not.toHaveBeenCalled();
  });

  it("allows POST when Origin is in ALLOWED_ORIGINS", async () => {
    // Must re-import with env set
    vi.resetModules();
    process.env.ALLOWED_ORIGINS = "https://myapp.com,https://staging.myapp.com";
    const mod = await import("../../src/middleware/csrf.js");
    const csrfWithEnv = mod.fastifyCsrfProtection;

    const request = createRequest({
      method: "POST",
      headers: {
        "x-requested-with": "XMLHttpRequest",
        origin: "https://myapp.com",
      },
      cookies: { access_token: "session-token" },
    });
    const reply = createReply();
    await csrfWithEnv(request, reply);
    expect(reply.code).not.toHaveBeenCalled();
  });

  it("handles malformed Origin header gracefully", async () => {
    const request = createRequest({
      method: "POST",
      headers: {
        "x-requested-with": "XMLHttpRequest",
        origin: "not-a-valid-url",
      },
      cookies: { access_token: "session-token" },
    });
    const reply = createReply();
    // Malformed origin is treated as non-local, non-allowed => blocked
    await fastifyCsrfProtection(request, reply);
    expect(reply.code).toHaveBeenCalledWith(403);
    expect(reply.send).toHaveBeenCalledWith({
      error: "CSRF validation failed. Origin not allowed.",
    });
  });

  it("blocks PUT with cookie auth but no X-Requested-With header", async () => {
    const request = createRequest({
      method: "PUT",
      headers: {},
      cookies: { access_token: "session-token" },
    });
    const reply = createReply();
    await fastifyCsrfProtection(request, reply);
    expect(reply.code).toHaveBeenCalledWith(403);
  });

  it("blocks DELETE with cookie auth but no X-Requested-With header", async () => {
    const request = createRequest({
      method: "DELETE",
      headers: {},
      cookies: { access_token: "session-token" },
    });
    const reply = createReply();
    await fastifyCsrfProtection(request, reply);
    expect(reply.code).toHaveBeenCalledWith(403);
  });

  it("blocks PATCH with cookie auth but no X-Requested-With header", async () => {
    const request = createRequest({
      method: "PATCH",
      headers: {},
      cookies: { access_token: "session-token" },
    });
    const reply = createReply();
    await fastifyCsrfProtection(request, reply);
    expect(reply.code).toHaveBeenCalledWith(403);
  });
});
