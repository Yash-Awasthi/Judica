import { Response, NextFunction } from "express";
import { randomUUID } from "crypto";
import { AuthRequest } from "../types/index.js";
import { requestContext } from "../lib/context.js";

/**
 * Attaches a unique X-Request-ID to every request and response.
 * Trace IDs are preserved throughout the request lifecycle for diagnostic logging.
 */
export function requestId(req: AuthRequest, res: Response, next: NextFunction) {
  const id = (req.headers["x-request-id"] as string) || randomUUID();
  req.requestId = id;
  res.setHeader("X-Request-ID", id);
  requestContext.run({ requestId: id }, () => {
    next();
  });
}
