import type { NodeHandler } from "../types.js";
import { validateSafeUrl } from "../../lib/ssrf.js";
import { resolve as dnsResolve } from "dns/promises";

// P10-100: Configurable response size limit (bytes)
const MAX_RESPONSE_SIZE = parseInt(process.env.HTTP_NODE_MAX_RESPONSE_BYTES || "10485760", 10); // 10MB default

export const httpHandler: NodeHandler = async (ctx) => {
  const rawUrl = ctx.nodeData.url as string;
  const method = ((ctx.nodeData.method as string) || "GET").toUpperCase();
  const rawHeaders = (ctx.nodeData.headers as Record<string, string>) ?? {};

  // P10-102: Reject headers containing newline characters (HTTP header injection)
  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(rawHeaders)) {
    if (/[\r\n]/.test(key) || /[\r\n]/.test(value)) {
      return {
        status: 0,
        data: null,
        error: `Invalid header: "${key}" contains newline characters (header injection attempt)`,
        headers: {},
      };
    }
    headers[key] = value;
  }
  const body = ctx.nodeData.body as string | Record<string, unknown> | undefined;

  // Validate URL against SSRF (blocks private IPs, localhost, cloud metadata)
  const url = await validateSafeUrl(rawUrl);

  // P10-99: Pin resolved IP to prevent DNS rebinding attacks
  const parsedUrl = new URL(url);
  const hostname = parsedUrl.hostname;
  let resolvedIp: string | undefined;
  try {
    const addresses = await dnsResolve(hostname);
    if (addresses.length > 0) {
      resolvedIp = addresses[0];
      // Re-validate the resolved IP against SSRF rules
      await validateSafeUrl(`${parsedUrl.protocol}//${resolvedIp}${parsedUrl.pathname}${parsedUrl.search}`);
    }
  } catch {
    // If DNS resolution fails, let fetch handle it normally
  }

  const fetchOptions: RequestInit = {
    method,
    headers: { ...headers, Host: hostname },
    signal: AbortSignal.timeout(30000),
    // P10-99: Disable redirect following to prevent SSRF bypass via redirects
    redirect: "error",
  };

  if (body && method !== "GET" && method !== "HEAD") {
    if (typeof body === "object") {
      fetchOptions.body = JSON.stringify(body);
      if (!headers["Content-Type"] && !headers["content-type"]) {
        (fetchOptions.headers as Record<string, string>)["Content-Type"] = "application/json";
      }
    } else {
      fetchOptions.body = body;
    }
  }

  // Use resolved IP if available to prevent DNS rebinding
  const fetchUrl = resolvedIp
    ? url.replace(hostname, resolvedIp)
    : url;

  const response = await fetch(fetchUrl, fetchOptions);

  // P10-100: Check content-length before reading body
  const contentLength = parseInt(response.headers.get("content-length") || "0", 10);
  if (contentLength > MAX_RESPONSE_SIZE) {
    return {
      status: response.status,
      data: null,
      error: `Response too large: ${contentLength} bytes (max ${MAX_RESPONSE_SIZE})`,
      headers: {},
    };
  }

  // P10-100: Read body with size limit
  let data: unknown;
  const contentType = response.headers.get("content-type") || "";
  const bodyText = await response.text();
  if (bodyText.length > MAX_RESPONSE_SIZE) {
    return {
      status: response.status,
      data: bodyText.slice(0, MAX_RESPONSE_SIZE),
      error: `Response truncated: exceeded ${MAX_RESPONSE_SIZE} bytes`,
      headers: {},
    };
  }

  if (contentType.includes("application/json")) {
    try {
      data = JSON.parse(bodyText);
    } catch {
      data = bodyText;
    }
  } else {
    data = bodyText;
  }

  // Convert response headers to plain object
  const responseHeaders: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    responseHeaders[key] = value;
  });

  return {
    status: response.status,
    data,
    headers: responseHeaders,
  };
};
