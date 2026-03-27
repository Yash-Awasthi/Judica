import { Request, Response, NextFunction } from "express";
import crypto from "crypto";

/**
 * Generates a cryptographically random nonce per request and attaches it to
 * `res.locals.cspNonce`. The nonce is used by the Helmet CSP config to replace
 * `'unsafe-inline'` on scripts, allowing inline scripts only when they carry
 * the matching nonce attribute.
 */
export function cspNonce(req: Request, res: Response, next: NextFunction) {
  res.locals.cspNonce = crypto.randomBytes(16).toString("base64");
  next();
}
