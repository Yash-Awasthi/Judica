import { describe, it, expect, vi, beforeEach } from "vitest";
import { fastifyCspNonce } from "../../src/middleware/cspNonce.js";

vi.mock("crypto", async () => {
  const actual = await vi.importActual<typeof import("crypto")>("crypto");
  return {
    ...actual,
    randomBytes: vi.fn(() => Buffer.from("dGVzdG5vbmNlMTIzNDU2", "base64")),
  };
});

// Mutable env object so individual tests can set/clear FRONTEND_URL
const mockEnv = vi.hoisted(() => ({} as Record<string, string | undefined>));
vi.mock("../../src/config/env.js", () => ({ env: mockEnv }));

function createMocks(overrides: Partial<{ accept: string; hostname: string; protocol: string }> = {}) {
  const request = {
    headers: { accept: overrides.accept ?? "text/html" },
    protocol: overrides.protocol ?? "https",
    hostname: overrides.hostname ?? "localhost",
  } as any;
  const headerValues: Record<string, string> = {};
  const reply = {
    header: vi.fn((name: string, value: string) => {
      headerValues[name] = value;
      return reply;
    }),
  } as any;
  return { request, reply, headerValues };
}

describe("fastifyCspNonce middleware", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete mockEnv.FRONTEND_URL;
  });

  it("sets a nonce on request.cspNonce", async () => {
    const { request, reply } = createMocks();
    await fastifyCspNonce(request, reply);
    expect(request.cspNonce).toBeDefined();
    expect(typeof request.cspNonce).toBe("string");
    expect(request.cspNonce.length).toBeGreaterThan(0);
  });

  it("sets Content-Security-Policy header containing the nonce", async () => {
    const { request, reply } = createMocks();
    await fastifyCspNonce(request, reply);

    const nonce = request.cspNonce;
    expect(reply.header).toHaveBeenCalledWith(
      "Content-Security-Policy",
      expect.stringContaining(`'nonce-${nonce}'`)
    );
  });

  it("CSP header contains all required directives", async () => {
    const { request, reply, headerValues } = createMocks();
    await fastifyCspNonce(request, reply);

    const cspHeader = headerValues["Content-Security-Policy"];
    expect(cspHeader).toContain("default-src 'self'");
    expect(cspHeader).toContain("script-src 'self'");
    expect(cspHeader).toContain("style-src 'self'");
    expect(cspHeader).toContain("object-src 'none'");
    expect(cspHeader).toContain("frame-ancestors 'none'");
  });
});

// ── Early return for non-HTML ─────────────────────────────────────────────────

describe("fastifyCspNonce — non-HTML early return", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete mockEnv.FRONTEND_URL;
  });

  it("skips CSP for application/json requests", async () => {
    const { request, reply } = createMocks({ accept: "application/json" });
    await fastifyCspNonce(request, reply);
    expect(reply.header).not.toHaveBeenCalled();
    expect(request.cspNonce).toBeUndefined();
  });

  it("skips CSP for requests with no Accept header", async () => {
    const { request, reply } = createMocks({ accept: "" });
    await fastifyCspNonce(request, reply);
    expect(reply.header).not.toHaveBeenCalled();
  });

  it("applies CSP for */* Accept header", async () => {
    const { request, reply } = createMocks({ accept: "*/*" });
    await fastifyCspNonce(request, reply);
    expect(reply.header).toHaveBeenCalled();
  });

  it("applies CSP for text/html;charset=UTF-8", async () => {
    const { request, reply } = createMocks({ accept: "text/html;charset=UTF-8" });
    await fastifyCspNonce(request, reply);
    expect(reply.header).toHaveBeenCalled();
  });
});

// ── FRONTEND_URL branch ───────────────────────────────────────────────────────

describe("fastifyCspNonce — with FRONTEND_URL set", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete mockEnv.FRONTEND_URL;
  });

  it("uses FRONTEND_URL for frontendUrl and wsOrigin when set (https → wss)", async () => {
    mockEnv.FRONTEND_URL = "https://myapp.example.com";
    const { request, reply, headerValues } = createMocks();

    await fastifyCspNonce(request, reply);

    const csp = headerValues["Content-Security-Policy"];
    expect(csp).toContain("wss://myapp.example.com");
    expect(csp).toContain("report-uri https://myapp.example.com/api/csp-report");
  });

  it("converts http FRONTEND_URL to ws:// for wsOrigin", async () => {
    mockEnv.FRONTEND_URL = "http://dev.local:3000";
    const { request, reply, headerValues } = createMocks();

    await fastifyCspNonce(request, reply);

    const csp = headerValues["Content-Security-Policy"];
    expect(csp).toContain("ws://dev.local:3000");
    expect(csp).toContain("report-uri http://dev.local:3000/api/csp-report");
  });
});

// ── Unsafe hostname sanitization ──────────────────────────────────────────────

describe("fastifyCspNonce — hostname sanitization (no FRONTEND_URL)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete mockEnv.FRONTEND_URL;
  });

  it("uses request hostname directly when it is safe", async () => {
    const { request, reply, headerValues } = createMocks({ hostname: "myapp.example.com" });
    await fastifyCspNonce(request, reply);

    const csp = headerValues["Content-Security-Policy"];
    expect(csp).toContain("ws://myapp.example.com");
    expect(csp).toContain("report-uri https://myapp.example.com/api/csp-report");
  });

  it("falls back to localhost when hostname contains unsafe characters", async () => {
    const { request, reply, headerValues } = createMocks({
      hostname: "evil.com/inject<script>",
    });
    await fastifyCspNonce(request, reply);

    const csp = headerValues["Content-Security-Policy"];
    // Unsafe hostname → sanitized to 'localhost'
    expect(csp).toContain("ws://localhost");
    expect(csp).not.toContain("inject");
    expect(csp).not.toContain("<script>");
  });

  it("falls back to localhost for hostname with angle brackets", async () => {
    const { request, reply, headerValues } = createMocks({ hostname: "<evil>" });
    await fastifyCspNonce(request, reply);

    const csp = headerValues["Content-Security-Policy"];
    expect(csp).toContain("ws://localhost");
  });
});
