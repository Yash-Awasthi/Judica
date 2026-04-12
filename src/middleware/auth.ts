import { Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { env } from "../config/env.js";
import { db } from "../lib/drizzle.js";
import { revokedTokens } from "../db/schema/auth.js";
import { eq } from "drizzle-orm";
import redis from "../lib/redis.js";
import logger from "../lib/logger.js";
import { AuthRequest } from "../types/index.js";

const jwtPayloadSchema = z.object({
  userId: z.number(),
  username: z.string(),
});

async function isTokenRevoked(token: string): Promise<boolean> {
  const revokedInRedis = await redis.get(`revoked:${token}`);
  if (revokedInRedis) return true;

  const [revokedInDB] = await db
    .select()
    .from(revokedTokens)
    .where(eq(revokedTokens.token, token))
    .limit(1);
  return !!revokedInDB;
}

export async function requireAuth(req: AuthRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  const token = authHeader.split(" ")[1];

  try {
    const decoded = jwt.verify(token, env.JWT_SECRET, { algorithms: ['HS256'] });
    const payload = jwtPayloadSchema.parse(decoded);

    if (await isTokenRevoked(token)) {
      res.status(401).json({ error: "Token revoked" });
      return;
    }

    req.userId = payload.userId;
    req.username = payload.username;
    next();
  } catch (e: any) {
    logger.debug({ error: e.message, path: req.path }, "JWT Verification failed");
    res.status(401).json({ error: "Invalid or expired token" });
  }
}

export async function optionalAuth(req: AuthRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    return next();
  }
  const token = authHeader.split(" ")[1];

  try {
    const decoded = jwt.verify(token, env.JWT_SECRET, { algorithms: ['HS256'] });
    const payload = jwtPayloadSchema.parse(decoded);

    if (await isTokenRevoked(token)) {
      res.status(401).json({ error: "Token revoked" });
      return;
    }

    req.userId = payload.userId;
    req.username = payload.username;
    next();
  } catch (e: any) {
    logger.debug({ error: e.message, path: req.path }, "Optional JWT Verification failed");
    next();
  }
}
