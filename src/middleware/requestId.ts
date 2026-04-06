import { randomUUID } from "crypto";
import { Request, Response, NextFunction } from "express";

export function requestId(req: Request, res: Response, next: NextFunction) {
  const id = (req.headers["x-request-id"] as string) || randomUUID();
  res.locals.requestId = id;
  res.setHeader("X-Request-ID", id);
  next();
}