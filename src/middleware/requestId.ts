import { randomUUID } from "crypto";
import { Request, Response, NextFunction } from "express";

/**
 * Attach a unique request ID to each request.
 * Uses the X-Request-ID header if present (from load balancer/proxy),
 * otherwise generates a new UUID.
 */
export function requestId(req: Request, res: Response, next: NextFunction) {
  const id = (req.headers["x-request-id"] as string) || randomUUID();
  res.locals.requestId = id;
  res.setHeader("X-Request-ID", id);
  next();
}