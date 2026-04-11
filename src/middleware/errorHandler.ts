import { env } from "../config/env.js";
import { Response, NextFunction } from "express";
import logger from "../lib/logger.js";
import { AuthRequest } from "../types/index.js";

export class AppError extends Error {
  constructor(
    public statusCode: number,
    public message: string,
    public code: string = 'INTERNAL_ERROR',
    public isOperational = true
  ) {
    super(message);
    Object.setPrototypeOf(this, AppError.prototype);
  }
}

export function errorHandler(
  err: Error,
  req: AuthRequest,
  res: Response,
  next: NextFunction
) {
  const requestId = req.requestId;

  if (err instanceof AppError) {
    logger.warn({
      statusCode: err.statusCode,
      message: err.message,
      path: req.path,
      requestId
    });
    res.status(err.statusCode).json({ error: err.message, code: err.code });
    return;
  }

  if ((err as any).name === "ZodError" || (err as any).issues) {
    res.status(400).json({ error: "Validation failed", details: (err as any).issues });
    return;
  }

  logger.error({
    err,
    path: req.path,
    method: req.method,
    requestId
  }, "Unhandled error");

  res.status(500).json({
    error: env.NODE_ENV === "production"
      ? "Internal server error"
      : err.message,
    code: "INTERNAL_ERROR",
  });
}