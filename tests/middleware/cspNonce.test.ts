import { describe, it, expect, vi, beforeEach } from "vitest";
import { cspNonce } from "../../src/middleware/cspNonce.js";

vi.mock("crypto", async () => {
  const actual = await vi.importActual<typeof import("crypto")>("crypto");
  return {
    ...actual,
    randomBytes: vi.fn(() => Buffer.from("dGVzdG5vbmNlMTIzNDU2", "base64")),
  };
});

function createMocks() {
  const req = {} as any;
  const headers: Record<string, string> = {};
  const res = {
    locals: {} as Record<string, any>,
    setHeader: vi.fn((name: string, value: string) => {
      headers[name] = value;
    }),
  } as any;
  const next = vi.fn();
  return { req, res, next, headers };
}

describe("cspNonce middleware", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sets a nonce on res.locals.cspNonce", () => {
    const { req, res, next } = createMocks();
    cspNonce(req, res, next);
    expect(res.locals.cspNonce).toBeDefined();
    expect(typeof res.locals.cspNonce).toBe("string");
    expect(res.locals.cspNonce.length).toBeGreaterThan(0);
  });

  it("sets Content-Security-Policy header containing the nonce", () => {
    const { req, res, next } = createMocks();
    cspNonce(req, res, next);

    const nonce = res.locals.cspNonce;
    expect(res.setHeader).toHaveBeenCalledWith(
      "Content-Security-Policy",
      expect.stringContaining(`'nonce-${nonce}'`)
    );
  });

  it("CSP header contains all required directives", () => {
    const { req, res, next } = createMocks();
    cspNonce(req, res, next);

    const cspHeader = res.setHeader.mock.calls[0][1] as string;
    expect(cspHeader).toContain("default-src 'self'");
    expect(cspHeader).toContain("script-src 'self'");
    expect(cspHeader).toContain("style-src 'self' 'unsafe-inline'");
    expect(cspHeader).toContain("object-src 'none'");
    expect(cspHeader).toContain("frame-ancestors 'none'");
  });

  it("calls next()", () => {
    const { req, res, next } = createMocks();
    cspNonce(req, res, next);
    expect(next).toHaveBeenCalledOnce();
    expect(next).toHaveBeenCalledWith();
  });
});
