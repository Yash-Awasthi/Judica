import { randomBytes } from "crypto";
import type { FastifyRequest, FastifyReply } from "fastify";

export async function fastifyCspNonce(request: FastifyRequest, reply: FastifyReply) {
  const nonce = randomBytes(16).toString("base64");
  (request as any).cspNonce = nonce;
  reply.header(
    "Content-Security-Policy",
    [
      "default-src 'self'",
      `script-src 'self' 'nonce-${nonce}' https://cdn.jsdelivr.net`,
      "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net",
      "img-src 'self' data: blob:",
      "connect-src 'self' wss: ws:",
      "font-src 'self'",
      "object-src 'none'",
      "base-uri 'self'",
      "frame-ancestors 'none'",
      "form-action 'self'",
      "upgrade-insecure-requests",
    ].join("; ")
  );
}
