import { randomBytes } from "crypto";
import { Request, Response, NextFunction } from "express";

export function cspNonce(req: Request, res: Response, next: NextFunction) {
  const nonce = randomBytes(16).toString("base64");
  res.locals.cspNonce = nonce;
  next();
}