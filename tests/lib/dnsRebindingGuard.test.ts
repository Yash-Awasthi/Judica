import { validateAtConnectionTime, buildPinnedUrl } from "../../src/lib/dnsRebindingGuard.js";
import { vi, describe, it, expect } from "vitest";
import dns from "dns";

// Mock DNS module for deterministic tests
vi.mock("dns", () => {
  const actual = vi.importActual("dns") as typeof import("dns");
  return {
    ...actual,
    default: {
      ...actual,
      resolve: vi.fn(),
      lookup: vi.fn(),
    },
  };
});

describe("dnsRebindingGuard", () => {
  describe("validateAtConnectionTime", () => {
    it("resolves a public IP successfully", async () => {
      (dns.resolve as ReturnType<typeof vi.fn>).mockImplementationOnce(
        (_hostname: string, callback: (err: null, addrs: string[]) => void) => {
          callback(null, ["93.184.216.34"]);
        }
      );

      const ip = await validateAtConnectionTime("api.example.com");
      expect(ip).toBe("93.184.216.34");
    });

    it("rejects when hostname resolves to private IP (rebinding detected)", async () => {
      (dns.resolve as ReturnType<typeof vi.fn>).mockImplementationOnce(
        (_hostname: string, callback: (err: null, addrs: string[]) => void) => {
          callback(null, ["192.168.1.1"]);
        }
      );

      await expect(validateAtConnectionTime("evil.com")).rejects.toThrow(
        /DNS rebinding protection/
      );
    });

    it("rejects when hostname resolves to loopback", async () => {
      (dns.resolve as ReturnType<typeof vi.fn>).mockImplementationOnce(
        (_hostname: string, callback: (err: null, addrs: string[]) => void) => {
          callback(null, ["127.0.0.1"]);
        }
      );

      await expect(validateAtConnectionTime("attacker.com")).rejects.toThrow(
        /restricted/i
      );
    });

    it("rejects when hostname resolves to metadata IP (169.254.x.x)", async () => {
      (dns.resolve as ReturnType<typeof vi.fn>).mockImplementationOnce(
        (_hostname: string, callback: (err: null, addrs: string[]) => void) => {
          callback(null, ["169.254.169.254"]);
        }
      );

      await expect(validateAtConnectionTime("attacker.com")).rejects.toThrow(
        /restricted/i
      );
    });

    it("logs warning when IP changes but new IP is still public (CDN rotation)", async () => {
      (dns.resolve as ReturnType<typeof vi.fn>).mockImplementationOnce(
        (_hostname: string, callback: (err: null, addrs: string[]) => void) => {
          callback(null, ["104.244.42.1"]); // different from expected 93.184.216.34
        }
      );

      // Should NOT throw — CDN IP rotation is benign if new IP is public
      const ip = await validateAtConnectionTime("cdn.example.com", "93.184.216.34");
      expect(ip).toBe("104.244.42.1");
    });
  });

  describe("buildPinnedUrl", () => {
    it("replaces hostname with resolved IPv4 address", () => {
      const { pinnedUrl, hostHeader } = buildPinnedUrl(
        "https://api.example.com/v1/chat",
        "93.184.216.34"
      );
      expect(pinnedUrl).toBe("https://93.184.216.34/v1/chat");
      expect(hostHeader).toBe("api.example.com");
    });

    it("preserves port in host header when present", () => {
      const { pinnedUrl, hostHeader } = buildPinnedUrl(
        "https://api.example.com:8443/v1",
        "93.184.216.34"
      );
      expect(pinnedUrl).toBe("https://93.184.216.34:8443/v1");
      expect(hostHeader).toBe("api.example.com:8443");
    });

    it("wraps IPv6 address in brackets", () => {
      const { pinnedUrl } = buildPinnedUrl(
        "https://api.example.com/v1",
        "2001:db8::1"
      );
      expect(pinnedUrl).toContain("[2001:db8::1]");
    });

    it("preserves query string and path", () => {
      const { pinnedUrl } = buildPinnedUrl(
        "https://api.example.com/search?q=test&limit=10",
        "93.184.216.34"
      );
      expect(pinnedUrl).toBe("https://93.184.216.34/search?q=test&limit=10");
    });
  });
});
