import { FastifyRequest, FastifyReply } from "fastify";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import { z } from "zod";
import { env } from "../config/env.js";
import { db } from "../lib/drizzle.js";
import { revokedTokens } from "../db/schema/auth.js";
import { eq } from "drizzle-orm";
import redis from "../lib/redis.js";
import logger from "../lib/logger.js";

// P8-46: Sanitize URLs for logging — strip tokens, keys, PII from query strings
function sanitizeUrlForLog(url: string): string {
  try {
    const parsed = new URL(url, "http://localhost");
    for (const key of parsed.searchParams.keys()) {
      if (/token|key|secret|password|auth|session/i.test(key)) {
        parsed.searchParams.set(key, "[REDACTED]");
      }
    }
    return parsed.pathname + parsed.search;
  } catch {
    return url.split("?")[0]; // fallback: strip entire query string
  }
}

const jwtPayloadSchema = z.object({
  userId: z.number(),
  username: z.string(),
  role: z.string().min(1),
});

declare module "fastify" {
  interface FastifyRequest {
    userId?: number;
    username?: string;
    role?: string;
  }
}

// P0-03: Hash tokens before storage/lookup to avoid storing plaintext JWTs
function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

async function isTokenRevoked(token: string): Promise<boolean> {
  const tokenHash = hashToken(token);
  const revokedInRedis = await redis.get(`revoked:${tokenHash}`);
  if (revokedInRedis) return true;

  const [revokedInDB] = await db.select().from(revokedTokens).where(eq(revokedTokens.token, tokenHash)).limit(1);
  return !!revokedInDB;
}

export async function fastifyOptionalAuth(request: FastifyRequest, _reply: FastifyReply) {
  const authHeader = request.headers.authorization;
  const tokenFromHeader = authHeader?.startsWith("Bearer ") ? authHeader.split(" ")[1] : null;
  const tokenFromCookie = (request as { cookies?: { access_token?: string } }).cookies?.access_token;
  const token = tokenFromHeader || tokenFromCookie;

  if (!token) return;

  try {
    const decoded = jwt.verify(token, env.JWT_SECRET, { algorithms: ['HS256'], issuer: "aibyai", audience: env.NODE_ENV, clockTolerance: 30 });
    const payload = jwtPayloadSchema.parse(decoded);

    if (await isTokenRevoked(token)) return;

    // P0-12: Check suspension status in optionalAuth too
    const userStatus = await redis.get(`user:status:${payload.userId}`);
    if (userStatus === "suspended") return;

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
  const tokenFromCookie = (request as { cookies?: { access_token?: string } }).cookies?.access_token;
  const token = tokenFromHeader || tokenFromCookie;

  if (!token) {
    reply.code(401).send({ error: "Authentication required" });
    return;
  }

  try {
    const decoded = jwt.verify(token, env.JWT_SECRET, { algorithms: ['HS256'], issuer: "aibyai", audience: env.NODE_ENV, clockTolerance: 30 });
    const payload = jwtPayloadSchema.parse(decoded);

    // P1-23: Unified revocation check — always use hashed token
    const tokenHash = hashToken(token);
    const pipeline = redis.pipeline();
    pipeline.get(`revoked:${tokenHash}`);
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
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    // P8-46: Sanitize URL before logging to prevent leaking tokens/keys
    logger.debug({ error: message, url: sanitizeUrlForLog(request.url) }, "JWT Verification failed");
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
