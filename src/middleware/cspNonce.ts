import { randomBytes } from "crypto";
import { Request, Response, NextFunction } from "express";

/**
 * Generate a unique CSP nonce for each request.
 * This nonce is injected into script tags to allow inline scripts
 * while maintaining a strict Content Security Policy.
 */
export function cspNonce(req: Request, res: Response, next: NextFunction) {
  const nonce = randomBytes(16).toString("base64");
  res.locals.cspNonce = nonce;
  next();
}