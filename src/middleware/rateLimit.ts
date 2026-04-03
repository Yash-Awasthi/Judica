import rateLimit from "express-rate-limit";
import { Request, Response, NextFunction } from "express";
import { env } from "../config/env.js";
import logger from "../lib/logger.js";

const commonHandler = (req: Request, res: Response, _next: NextFunction, options: any) => {
  logger.warn({
    path: req.path,
    ip: req.ip,
  }, "Rate limit exceeded");
  res.status(options.statusCode).send(options.message);
};

// Use req.ip directly which express-rate-limit knows how to handle correctly for IPv6
// Or omit keyGenerator completely if we just want to limit by IP, as it defaults to req.ip

export const askLimiter = rateLimit({
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  max: 1000,
  keyGenerator: (req: any) => {
    // Combine user ID with IP to prevent multi-account abuse
    if (req.userId) {
      const ip = req.ip || "127.0.0.1";
      return `user:${req.userId}:${ip}`;
    }
    return req.ip || "127.0.0.1";
  },
  message: { error: "Too many requests, slow down." },
  standardHeaders: true,
  legacyHeaders: false,
  handler: commonHandler,
  validate: { keyGeneratorIpFallback: false }
});

export const authLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 1000,
  keyGenerator: (req: any) => {
    // Combine user ID with IP to prevent multi-account abuse
    if (req.userId) {
      const ip = req.ip || "127.0.0.1";
      return `user:${req.userId}:${ip}`;
    }
    return req.ip || "127.0.0.1";
  },
  message: { error: "Too many auth attempts, try again later." },
  standardHeaders: true,
  legacyHeaders: false,
  handler: commonHandler,
  validate: { keyGeneratorIpFallback: false }
});