import { FastifyRequest, FastifyReply } from "fastify";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { env } from "../config/env.js";
import { db } from "../lib/drizzle.js";
import { revokedTokens } from "../db/schema/auth.js";
import { eq } from "drizzle-orm";
import redis from "../lib/redis.js";
import logger from "../lib/logger.js";

const jwtPayloadSchema = z.object({
  userId: z.number(),
  username: z.string(),
  role: z.string().default("member"),
});

declare module "fastify" {
  interface FastifyRequest {
    userId?: number;
    username?: string;
    role?: string;
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
  const tokenFromHeader = authHeader?.startsWith("Bearer ") ? authHeader.split(" ")[1] : null;
  const tokenFromCookie = (request as any).cookies?.access_token;
  const token = tokenFromHeader || tokenFromCookie;

  if (!token) return;

  try {
    const decoded = jwt.verify(token, env.JWT_SECRET, { algorithms: ['HS256'] });
    const payload = jwtPayloadSchema.parse(decoded);

    if (await isTokenRevoked(token)) return;

    request.userId = payload.userId;
    request.username = payload.username;
    request.role = payload.role;
  } catch {
    // Silently ignore invalid tokens for optional auth
  }
}

export async function fastifyRequireAuth(request: FastifyRequest, reply: FastifyReply) {
  const authHeader = request.headers.authorization;
  const tokenFromHeader = authHeader?.startsWith("Bearer ") ? authHeader.split(" ")[1] : null;
  const tokenFromCookie = (request as any).cookies?.access_token;
  const token = tokenFromHeader || tokenFromCookie;

  if (!token) {
    reply.code(401).send({ error: "Authentication required" });
    return;
  }

  try {
    const decoded = jwt.verify(token, env.JWT_SECRET, { algorithms: ['HS256'] });
    const payload = jwtPayloadSchema.parse(decoded);

    // Pipeline both Redis checks into a single round-trip
    const pipeline = redis.pipeline();
    pipeline.get(`revoked:${token}`);
    pipeline.get(`user:status:${payload.userId}`);
    const results = await pipeline.exec();

    const [revokedResult, statusResult] = results ?? [];
    const isRevoked = revokedResult?.[1];
    const userStatus = statusResult?.[1];

    if (isRevoked) {
      reply.code(401).send({ error: "Token revoked" });
      return;
    }

    if (userStatus === "suspended") {
      reply.code(403).send({ error: "Account suspended" });
      return;
    }

    request.userId = payload.userId;
    request.username = payload.username;
    request.role = payload.role;
  } catch (e: any) {
    logger.debug({ error: e.message, url: request.url }, "JWT Verification failed");
    reply.code(401).send({ error: "Invalid or expired token" });
  }
}

export async function fastifyRequireAdmin(request: FastifyRequest, reply: FastifyReply) {
  await fastifyRequireAuth(request, reply);
  if (reply.sent) return;

  if (request.role !== "admin" && request.role !== "owner") {
    reply.code(403).send({ error: "Admin access required" });
    return;
  }
}

/**
 * Role hierarchy: owner > admin > member > viewer
 * Usage: preHandler: fastifyRequireRole("admin")
 */
const ROLE_RANK: Record<string, number> = {
  viewer: 1,
  member: 2,
  admin: 3,
  owner: 4,
};

export function fastifyRequireRole(minRole: "viewer" | "member" | "admin" | "owner") {
  return async function (request: FastifyRequest, reply: FastifyReply) {
    await fastifyRequireAuth(request, reply);
    if (reply.sent) return;

    const userRank = ROLE_RANK[request.role ?? "member"] ?? 0;
    const requiredRank = ROLE_RANK[minRole];

    if (userRank < requiredRank) {
      reply.code(403).send({ error: `Role '${minRole}' or higher required` });
    }
  };
}
