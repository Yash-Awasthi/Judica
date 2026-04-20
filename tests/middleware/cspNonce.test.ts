import { describe, it, expect, vi, beforeEach } from "vitest";
import { fastifyCspNonce } from "../../src/middleware/cspNonce.js";

vi.mock("crypto", async () => {
  const actual = await vi.importActual<typeof import("crypto")>("crypto");
  return {
    ...actual,
    randomBytes: vi.fn(() => Buffer.from("dGVzdG5vbmNlMTIzNDU2", "base64")),
  };
});

function createMocks() {
  const request = {
    headers: { accept: "text/html" },
    protocol: "https",
    hostname: "localhost",
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
