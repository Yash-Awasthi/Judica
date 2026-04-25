import { describe, it, expect, vi, beforeEach } from "vitest";
import dns from "dns";

// We import the real module — no heavy mocking needed for pure functions.
// DNS lookup is mocked to control IP resolution for validateSafeUrl tests.
vi.mock("dns", async (importOriginal) => {
  const actual = await importOriginal<typeof import("dns")>();
  return {
    ...actual,
    default: {
      ...actual,
      lookup: vi.fn(),
    },
    lookup: vi.fn(),
  };
});

import { isPrivateIP, validateSafeUrl } from "../../src/lib/ssrf.js";

// ── Helper: make dns.lookup resolve to a given IP ────────────────────
function mockDnsLookup(ip: string) {
  (dns.lookup as any).mockImplementation(
    (_hostname: string, _opts: any, cb?: Function) => {
      // promisify style: if no callback, return via the 2-arg overload
      if (typeof _opts === "function") {
        cb = _opts;
      }
      if (cb) {
        cb(null, [{ address: ip, family: 4 }]);
      }
    }
  );
}

// ── isPrivateIP ──────────────────────────────────────────────────────
describe("SSRF — isPrivateIP", () => {
  beforeEach(() => vi.clearAllMocks());

  it("should flag 127.0.0.1 (loopback) as private", () => {
    expect(isPrivateIP("127.0.0.1")).toBe(true);
  });

  it("should flag 127.255.255.255 as private", () => {
    expect(isPrivateIP("127.255.255.255")).toBe(true);
  });

  it("should flag 10.x.x.x as private", () => {
    expect(isPrivateIP("10.0.0.1")).toBe(true);
    expect(isPrivateIP("10.255.255.255")).toBe(true);
  });

  it("should flag 172.16.x.x – 172.31.x.x as private", () => {
    expect(isPrivateIP("172.16.0.1")).toBe(true);
    expect(isPrivateIP("172.31.255.255")).toBe(true);
  });

  it("should NOT flag 172.32.0.1 as private", () => {
    expect(isPrivateIP("172.32.0.1")).toBe(false);
  });

  it("should flag 192.168.x.x as private", () => {
    expect(isPrivateIP("192.168.0.1")).toBe(true);
    expect(isPrivateIP("192.168.255.255")).toBe(true);
  });

  it("should flag cloud metadata IP 169.254.169.254 as private", () => {
    expect(isPrivateIP("169.254.169.254")).toBe(true);
  });

  it("should flag 0.0.0.0 as private", () => {
    expect(isPrivateIP("0.0.0.0")).toBe(true);
  });

  it("should flag IPv6 loopback ::1 as private", () => {
    expect(isPrivateIP("::1")).toBe(true);
  });

  it("should allow a valid public IP", () => {
    expect(isPrivateIP("8.8.8.8")).toBe(false);
    expect(isPrivateIP("1.1.1.1")).toBe(false);
    expect(isPrivateIP("93.184.216.34")).toBe(false);
  });

  it("should return false for non-IP strings", () => {
    expect(isPrivateIP("not-an-ip")).toBe(false);
    expect(isPrivateIP("")).toBe(false);
  });
});

// ── validateSafeUrl ──────────────────────────────────────────────────
describe("SSRF — validateSafeUrl", () => {
  beforeEach(() => vi.clearAllMocks());

  it("should block file:// protocol", async () => {
    await expect(validateSafeUrl("file:///etc/passwd")).rejects.toThrow(
      "Protocol must be http: or https:"
    );
  });

  it("should block ftp:// protocol", async () => {
    await expect(validateSafeUrl("ftp://example.com/file")).rejects.toThrow(
      "Protocol must be http: or https:"
    );
  });

  it("should block localhost hostname", async () => {
    await expect(validateSafeUrl("http://localhost/admin")).rejects.toThrow(
      /restricted/i
    );
  });

  it("should block .local hostnames", async () => {
    await expect(validateSafeUrl("http://myhost.local/api")).rejects.toThrow(
      /restricted/i
    );
  });

  it("should block .internal hostnames", async () => {
    await expect(validateSafeUrl("http://something.internal/api")).rejects.toThrow(
      /restricted/i
    );
  });

  it("should block metadata.google.internal", async () => {
    await expect(
      validateSafeUrl("http://metadata.google.internal/computeMetadata/v1/")
    ).rejects.toThrow(/restricted/i);
  });

  it("should reject invalid URL format", async () => {
    await expect(validateSafeUrl("not a url")).rejects.toThrow("Invalid URL format");
  });
});
