import dns from "dns";
import net from "net";
import { URL } from "url";
import { promisify } from "util";

const lookup = promisify(dns.lookup);

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

export async function validateSafeUrl(urlInput: string): Promise<string> {
  let url: URL;
  try {
    url = new URL(urlInput);
  } catch (err) {
    throw new Error("Invalid URL format", { cause: err });
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Protocol must be http: or https:");
  }

  const hostname = url.hostname.toLowerCase();
  if (
    hostname === "localhost" ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal") ||
    hostname === "metadata.google.internal"
  ) {
    throw new Error(`Hostname ${hostname} is restricted`);
  }

  try {
    const result = await lookup(hostname, { all: true });

    if (!result || result.length === 0) {
      throw new Error(`Could not resolve hostname ${hostname}`);
    }

    for (const res of result) {
      if (isPrivateIP(res.address)) {
        throw new Error(`URL resolves to a restricted IP address (${res.address})`);
      }
    }
  } catch (err) {
    if ((err as Error).message.includes("restricted IP")) {
      throw err;
    }
    throw new Error("Failed to resolve URL hostname: " + (err as Error).message, { cause: err });
  }

  return url.toString();
}
