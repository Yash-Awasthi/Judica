import { randomBytes } from "crypto";
import type { FastifyRequest, FastifyReply } from "fastify";
import { env } from "../config/env.js";

export async function fastifyCspNonce(request: FastifyRequest, reply: FastifyReply) {
  // P8-57: Only apply CSP to HTML responses — skip for API (JSON) responses
  const accept = request.headers.accept || "";
  if (!accept.includes("text/html") && !accept.includes("*/*")) {
    return;
  }

  const nonce = randomBytes(16).toString("base64");
  (request as unknown as { cspNonce: string }).cspNonce = nonce;

  // P1-27: Derive allowed WS origin from FRONTEND_URL or request host
  const frontendUrl = env.FRONTEND_URL || `${request.protocol}://${request.hostname}`;
  const wsOrigin = frontendUrl.replace(/^http/, "ws");

  // P8-56: CSP violation reporting endpoint
  const reportUri = `${frontendUrl}/api/csp-report`;

  reply.header(
    "Content-Security-Policy",
    [
      "default-src 'self'",
      // P1-26: Pin cdn.jsdelivr.net to specific package subpaths
      `script-src 'self' 'nonce-${nonce}' https://cdn.jsdelivr.net/npm/`,
      // P8-55: Removed unsafe-inline — use nonce-based inline styles instead
      `style-src 'self' 'nonce-${nonce}' https://cdn.jsdelivr.net/npm/`,
      "img-src 'self' data: blob:",
      // P1-27: Restrict WebSocket connections to our domain only
      `connect-src 'self' ${wsOrigin}`,
      "font-src 'self'",
      "object-src 'none'",
      "base-uri 'self'",
      "frame-ancestors 'none'",
      "form-action 'self'",
      "upgrade-insecure-requests",
      // P8-56: Report CSP violations for detection
      `report-uri ${reportUri}`,
    ].join("; ")
  );
}
