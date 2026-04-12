import { FastifyRequest, FastifyReply } from "fastify";
import jwt from "jsonwebtoken";
import { z } from "zod/v4";
import { env } from "../config/env.js";
import { db } from "../lib/drizzle.js";
import { revokedTokens } from "../db/schema/auth.js";
import { eq } from "drizzle-orm";
import redis from "../lib/redis.js";
import logger from "../lib/logger.js";

const jwtPayloadSchema = z.object({
  userId: z.number(),
  username: z.string(),
});

declare module "fastify" {
  interface FastifyRequest {
    userId?: number;
    username?: string;
  }
}

async function isTokenRevoked(token: string): Promise<boolean> {
  const revokedInRedis = await redis.get(`revoked:${token}`);
  if (revokedInRedis) return true;

  const [revokedInDB] = await db.select().from(revokedTokens).where(eq(revokedTokens.token, token)).limit(1);
  return !!revokedInDB;
}

export async function fastifyOptionalAuth(request: FastifyRequest, reply: FastifyReply) {
  const authHeader = request.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) return;

  try {
    const token = authHeader.split(" ")[1];
    const decoded = jwt.verify(token, env.JWT_SECRET, { algorithms: ['HS256'] });
    const payload = jwtPayloadSchema.parse(decoded);

    if (await isTokenRevoked(token)) return;

    request.userId = payload.userId;
    request.username = payload.username;
  } catch {
    // Silently ignore invalid tokens for optional auth
  }
}

export async function fastifyRequireAuth(request: FastifyRequest, reply: FastifyReply) {
  const authHeader = request.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    reply.code(401).send({ error: "Authentication required" });
    return;
  }
  const token = authHeader.split(" ")[1];

  try {
    const decoded = jwt.verify(token, env.JWT_SECRET, { algorithms: ['HS256'] });
    const payload = jwtPayloadSchema.parse(decoded);

    if (await isTokenRevoked(token)) {
      reply.code(401).send({ error: "Token revoked" });
      return;
    }

    request.userId = payload.userId;
    request.username = payload.username;
  } catch (e: any) {
    logger.debug({ error: e.message, url: request.url }, "JWT Verification failed");
    reply.code(401).send({ error: "Invalid or expired token" });
  }
}
