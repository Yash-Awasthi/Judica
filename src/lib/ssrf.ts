import dns from "dns";
import net from "net";
import { URL } from "url";

// P0-26: Allowed ports whitelist
const ALLOWED_PORTS = new Set([80, 443, 8080, 8443]);

export function isPrivateIP(ip: string): boolean {
  if (!net.isIP(ip)) return false;

  if (net.isIPv4(ip)) {
    const parts = ip.split(".").map((p) => parseInt(p, 10));

    if (parts[0] === 0) return true;
    if (parts[0] === 10) return true;
    if (parts[0] === 127) return true;
    if (parts[0] === 169 && parts[1] === 254) return true;
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
    if (parts[0] === 192 && parts[1] === 168) return true;
    if (parts[0] >= 224 && parts[0] <= 239) return true;
    if (parts[0] >= 240 && parts[0] <= 255) return true;

    // P0-24: Block CGN (Carrier-Grade NAT) range — covers Alibaba metadata 100.100.100.200
    if (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127) return true;

    // P0-25: Block TEST-NET ranges
    if (parts[0] === 192 && parts[1] === 0 && parts[2] === 2) return true;       // 192.0.2.0/24
    if (parts[0] === 198 && parts[1] === 51 && parts[2] === 100) return true;     // 198.51.100.0/24
    if (parts[0] === 203 && parts[1] === 0 && parts[2] === 113) return true;      // 203.0.113.0/24
    if (parts[0] === 198 && parts[1] >= 18 && parts[1] <= 19) return true;        // 198.18.0.0/15

    return false;
  } else if (net.isIPv6(ip)) {
    const lowerIP = ip.toLowerCase();

    if (lowerIP === "::1" || lowerIP === "0:0:0:0:0:0:0:1") return true;
    if (lowerIP === "::" || lowerIP === "0:0:0:0:0:0:0:0") return true;

    if (lowerIP.startsWith("::ffff:")) {
      const v4part = lowerIP.slice(7);
      if (v4part.includes(".")) {
        return isPrivateIP(v4part);
      }
    }

    if (lowerIP.startsWith("fc") || lowerIP.startsWith("fd")) return true;
    if (lowerIP.startsWith("fe8") || lowerIP.startsWith("fe9") || lowerIP.startsWith("fea") || lowerIP.startsWith("feb")) return true;
    if (lowerIP.startsWith("ff")) return true;

    return false;
  }

  return false;
}

// P0-27: DNS lookup with timeout
const DNS_TIMEOUT_MS = 2000;

async function safeLookup(hostname: string): Promise<dns.LookupAddress[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DNS_TIMEOUT_MS);

  try {
    // H-1 fix: pass signal to dns.promises.lookup so the abort actually cancels
    // the in-flight query (Node 18+ / Node 22 supports AbortSignal here).
    const result = await dns.promises.lookup(hostname, {
      all: true,
      signal: controller.signal,
    } as dns.LookupAllOptions & { signal: AbortSignal });
    return result;
  } finally {
    clearTimeout(timeout);
  }
}

// P0-22: Proper hostname validation for Ollama (parse URL, check hostname)
function isLocalhostHostname(hostname: string): boolean {
  const lower = hostname.toLowerCase();
  return lower === "localhost" ||
    lower === "127.0.0.1" ||
    lower === "::1" ||
    lower === "[::1]" ||
    lower === "0.0.0.0" ||
    lower.endsWith(".localhost");
}

/**
 * Validates a URL is safe from SSRF attacks.
 * Returns the validated URL string.
 * For DNS rebinding protection, use validateSafeUrlWithIP() which also returns the resolved IP.
 */
export async function validateSafeUrl(urlInput: string, options?: { allowLocalhost?: boolean }): Promise<string> {
  const { url } = await validateSafeUrlWithIP(urlInput, options);
  return url;
}

/**
 * Validates a URL and returns both the URL and resolved IP for DNS pinning.
 * P0-23: Caller should fetch by IP with Host header preserved to prevent DNS rebinding.
 */
export async function validateSafeUrlWithIP(urlInput: string, options?: { allowLocalhost?: boolean }): Promise<{ url: string; resolvedIP: string }> {
  let url: URL;
  try {
    url = new URL(urlInput);
  } catch (err) {
    throw new Error("Invalid URL format", { cause: err });
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Protocol must be http: or https:");
  }

  // H-1 fix: reject userinfo components to prevent parser-confusion attacks
  // e.g. http://user@attacker.com@127.0.0.1/ being parsed differently across runtimes
  if (url.username || url.password) {
    throw new Error("URL must not contain userinfo components");
  }

  // P0-26: Port whitelist
  const port = url.port ? parseInt(url.port, 10) : (url.protocol === "https:" ? 443 : 80);
  if (!ALLOWED_PORTS.has(port)) {
    throw new Error(`Port ${port} is not allowed. Permitted: ${[...ALLOWED_PORTS].join(", ")}`);
  }

  const hostname = url.hostname.toLowerCase()
    // Strip IPv6 brackets
    .replace(/^\[|\]$/g, "")
    // L-3: Strip IPv6 zone ID (e.g. fe80::1%eth0) before validation to prevent bypass
    .replace(/%[a-zA-Z0-9._~-]+$/, "");

  // P0-22: Proper localhost check via parsed hostname
  if (!options?.allowLocalhost && isLocalhostHostname(hostname)) {
    throw new Error("Hostname is restricted");
  }

  if (
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal") ||
    hostname === "metadata.google.internal"
  ) {
    throw new Error("Hostname is restricted");
  }

  try {
    const result = await safeLookup(hostname);

    if (!result || result.length === 0) {
      throw new Error("Could not resolve hostname");
    }

    for (const res of result) {
      if (isPrivateIP(res.address)) {
        // P0-28: Don't leak the resolved IP in error messages
        throw new Error("URL resolves to a restricted network address");
      }
    }

    // P0-23: Return first resolved IP for DNS rebinding protection
    return { url: url.toString(), resolvedIP: result[0].address };
  } catch (err) {
    if ((err as Error).message.includes("restricted")) {
      throw err;
    }
    if ((err as Error).name === "AbortError") {
      throw new Error("DNS lookup timed out", { cause: err });
    }
    throw new Error("Failed to resolve URL hostname", { cause: err });
  }
}
