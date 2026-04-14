import { randomBytes } from "crypto";
import { Request, Response, NextFunction } from "express";
import type { FastifyRequest, FastifyReply } from "fastify";

export function cspNonce(req: Request, res: Response, next: NextFunction) {
  const nonce = randomBytes(16).toString("base64");
  res.locals.cspNonce = nonce;
  res.setHeader(
    "Content-Security-Policy",
    `default-src 'self'; script-src 'self' 'nonce-${nonce}'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' wss: ws:; font-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none';`
  );
  next();
}

// ---------- Fastify-native version ----------

export async function fastifyCspNonce(request: FastifyRequest, reply: FastifyReply) {
  const nonce = randomBytes(16).toString("base64");
  (request as any).cspNonce = nonce;
  reply.header(
    "Content-Security-Policy",
    `default-src 'self'; script-src 'self' 'nonce-${nonce}'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' wss: ws:; font-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none';`
  );
}
