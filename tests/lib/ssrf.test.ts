import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock DNS lookup
vi.mock("dns", () => ({
  default: {
    lookup: vi.fn((hostname, options, callback) => {
        if (hostname === "example.com") {
            callback(null, [{ address: "93.184.216.34", family: 4 }]);
        } else if (hostname === "internal.server") {
            callback(null, [{ address: "192.168.1.100", family: 4 }]);
        } else if (hostname === "localhost") {
            callback(null, [{ address: "127.0.0.1", family: 4 }]);
        } else if (hostname === "unresolvable") {
            callback(new Error("ENOTFOUND"), null);
        } else if (hostname === "ipv6-test.com") {
            callback(null, [{ address: "::1", family: 6 }]);
        } else {
            callback(null, [{ address: "8.8.8.8", family: 4 }]);
        }
    }),
  },
}));

describe("SSRF", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe("isPrivateIP", () => {
        it("should return true for private IPv4 addresses", async () => {
            const { isPrivateIP } = await import("../../src/lib/ssrf.js");
            expect(isPrivateIP("10.0.0.1")).toBe(true);
            expect(isPrivateIP("127.0.0.1")).toBe(true);
            expect(isPrivateIP("172.16.0.1")).toBe(true);
            expect(isPrivateIP("192.168.1.1")).toBe(true);
            expect(isPrivateIP("0.0.0.0")).toBe(true);
        });

        it("should return false for public IPv4 addresses", async () => {
            const { isPrivateIP } = await import("../../src/lib/ssrf.js");
            expect(isPrivateIP("8.8.8.8")).toBe(false);
            expect(isPrivateIP("93.184.216.34")).toBe(false);
        });

        it("should return true for private IPv6 addresses", async () => {
            const { isPrivateIP } = await import("../../src/lib/ssrf.js");
            expect(isPrivateIP("::1")).toBe(true);
            expect(isPrivateIP("fd00::1")).toBe(true);
            expect(isPrivateIP("fe80::1")).toBe(true);
            expect(isPrivateIP("::ffff:127.0.0.1")).toBe(true);
        });

        it("should return false for invalid IPs", async () => {
            const { isPrivateIP } = await import("../../src/lib/ssrf.js");
            expect(isPrivateIP("not_an_ip")).toBe(false);
        });
    });

    describe("validateSafeUrl", () => {
        it("should allow safe URLs", async () => {
            const { validateSafeUrl } = await import("../../src/lib/ssrf.js");
            const result = await validateSafeUrl("https://example.com/path?q=1");
            expect(result).toBe("https://example.com/path?q=1");
        });

        it("should reject invalid protocols", async () => {
            const { validateSafeUrl } = await import("../../src/lib/ssrf.js");
            await expect(validateSafeUrl("ftp://example.com")).rejects.toThrow("Protocol must be http: or https:");
            await expect(validateSafeUrl("file:///etc/passwd")).rejects.toThrow("Protocol must be http: or https:");
        });

        it("should reject invalid formatting", async () => {
            const { validateSafeUrl } = await import("../../src/lib/ssrf.js");
            await expect(validateSafeUrl("not_a_url")).rejects.toThrow("Invalid URL format");
        });

        it("should reject restricted hostnames directly", async () => {
            const { validateSafeUrl } = await import("../../src/lib/ssrf.js");
            await expect(validateSafeUrl("http://localhost/api")).rejects.toThrow("Hostname localhost is restricted");
            await expect(validateSafeUrl("http://my.local/api")).rejects.toThrow("Hostname my.local is restricted");
            await expect(validateSafeUrl("http://metadata.google.internal/api")).rejects.toThrow("Hostname metadata.google.internal is restricted");
        });

        it("should reject hostnames that resolve to private IPs", async () => {
            const { validateSafeUrl } = await import("../../src/lib/ssrf.js");
            await expect(validateSafeUrl("http://internal.server/api")).rejects.toThrow("URL resolves to a restricted IP address (192.168.1.100)");
            await expect(validateSafeUrl("http://ipv6-test.com/api")).rejects.toThrow("URL resolves to a restricted IP address (::1)");
        });

        it("should handle unresolvable hostnames", async () => {
            const { validateSafeUrl } = await import("../../src/lib/ssrf.js");
            await expect(validateSafeUrl("http://unresolvable")).rejects.toThrow("Failed to resolve URL hostname: ENOTFOUND");
        });
    });
});
