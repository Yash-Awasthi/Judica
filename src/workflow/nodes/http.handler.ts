import type { NodeHandler } from "../types.js";
import { validateSafeUrl } from "../../lib/ssrf.js";

export const httpHandler: NodeHandler = async (ctx) => {
  const rawUrl = ctx.nodeData.url as string;
  const method = ((ctx.nodeData.method as string) || "GET").toUpperCase();
  const headers = (ctx.nodeData.headers as Record<string, string>) ?? {};
  const body = ctx.nodeData.body as string | Record<string, unknown> | undefined;

  // Validate URL against SSRF (blocks private IPs, localhost, cloud metadata)
  const url = await validateSafeUrl(rawUrl);

  const fetchOptions: RequestInit = {
    method,
    headers,
    signal: AbortSignal.timeout(30000),
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

  const response = await fetch(url, fetchOptions);

  let data: unknown;
  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    data = await response.json();
  } else {
    data = await response.text();
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
