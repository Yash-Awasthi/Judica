import { randomBytes } from "crypto";
import type { FastifyRequest, FastifyReply } from "fastify";

export async function fastifyCspNonce(request: FastifyRequest, reply: FastifyReply) {
  const nonce = randomBytes(16).toString("base64");
  (request as any).cspNonce = nonce;
  reply.header(
    "Content-Security-Policy",
    `default-src 'self'; script-src 'self' 'nonce-${nonce}'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' wss: ws:; font-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none';`
  );
}
