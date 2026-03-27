import dns from "dns";
import net from "net";
import { URL } from "url";
import { promisify } from "util";

const lookup = promisify(dns.lookup);

/**
 * Checks if an IPv4 or IPv6 address belongs to a private, loopback, or non-routable range.
 */
export function isPrivateIP(ip: string): boolean {
  if (!net.isIP(ip)) return false;

  if (net.isIPv4(ip)) {
    const parts = ip.split(".").map((p) => parseInt(p, 10));

    // 0.0.0.0/8 (Current network)
    if (parts[0] === 0) return true;
    // 10.0.0.0/8 (Private)
    if (parts[0] === 10) return true;
    // 127.0.0.0/8 (Loopback)
    if (parts[0] === 127) return true;
    // 169.254.0.0/16 (Link-local, AWS metadata)
    if (parts[0] === 169 && parts[1] === 254) return true;
    // 172.16.0.0/12 (Private)
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
    // 192.168.0.0/16 (Private)
    if (parts[0] === 192 && parts[1] === 168) return true;
    // 224.0.0.0/4 (Multicast)
    if (parts[0] >= 224 && parts[0] <= 239) return true;
    // 240.0.0.0/4 (Future use)
    if (parts[0] >= 240 && parts[0] <= 255) return true;

    return false;
  } else if (net.isIPv6(ip)) {
    const lowerIP = ip.toLowerCase();

    // ::1/128 (Loopback)
    if (lowerIP === "::1" || lowerIP === "0:0:0:0:0:0:0:1") return true;
    // ::/128 (Unspecified)
    if (lowerIP === "::" || lowerIP === "0:0:0:0:0:0:0:0") return true;

    // IPv4-mapped IPv6 addresses (::ffff:0:0/96)
    if (lowerIP.startsWith("::ffff:")) {
      const v4part = lowerIP.slice(7);
      if (v4part.includes(".")) {
        return isPrivateIP(v4part);
      }
    }

    // fc00::/7 (Unique local addresses)
    if (lowerIP.startsWith("fc") || lowerIP.startsWith("fd")) return true;
    // fe80::/10 (Link-local addresses)
    if (lowerIP.startsWith("fe8") || lowerIP.startsWith("fe9") || lowerIP.startsWith("fea") || lowerIP.startsWith("feb")) return true;
    // ff00::/8 (Multicast)
    if (lowerIP.startsWith("ff")) return true;

    return false;
  }

  return false;
}

/**
 * Validates a given URL to ensure it does not point to internal/private infrastructure.
 * Throws an Error if the URL is invalid or unsafe.
 */
export async function validateSafeUrl(urlInput: string): Promise<string> {
  let url: URL;
  try {
    url = new URL(urlInput);
  } catch (err) {
    throw new Error("Invalid URL format", { cause: err });
  }

  // 1. Must be http or https
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Protocol must be http: or https:");
  }

  // 2. Reject obvious internal names
  const hostname = url.hostname.toLowerCase();
  if (
    hostname === "localhost" ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal") ||
    hostname === "metadata.google.internal"
  ) {
    throw new Error(`Hostname ${hostname} is restricted`);
  }

  // 3. Prevent octal/hex IP evasion by dns resolving the hostname
  try {
    // We request both IPv4 and IPv6 resolution
    const result = await lookup(hostname, { all: true });

    if (!result || result.length === 0) {
      throw new Error(`Could not resolve hostname ${hostname}`);
    }

    // 4. Check if any of the resolved IPs are private
    for (const res of result) {
      if (isPrivateIP(res.address)) {
        throw new Error(`URL resolves to a restricted IP address (${res.address})`);
      }
    }
  } catch (err: any) {
    if (err.message.includes("restricted IP")) {
      throw err;
    }
    throw new Error("Failed to resolve URL hostname: " + err.message, { cause: err });
  }

  return url.toString();
}
