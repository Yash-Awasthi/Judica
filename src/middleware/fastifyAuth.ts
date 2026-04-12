import { FastifyRequest, FastifyReply } from "fastify";
import jwt from "jsonwebtoken";
import { env } from "../config/env.js";
import prisma from "../lib/db.js";
import redis from "../lib/redis.js";
import logger from "../lib/logger.js";

declare module "fastify" {
  interface FastifyRequest {
    userId?: number;
    username?: string;
  }
}

async function isTokenRevoked(token: string): Promise<boolean> {
  const revokedInRedis = await redis.get(`revoked:${token}`);
  if (revokedInRedis) return true;

  const revokedInDB = await prisma.revokedToken.findUnique({ where: { token } });
  return !!revokedInDB;
}

export async function fastifyRequireAuth(request: FastifyRequest, reply: FastifyReply) {
  const authHeader = request.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    reply.code(401).send({ error: "Authentication required" });
    return;
  }
  const token = authHeader.split(" ")[1];

  try {
    const payload = jwt.verify(token, env.JWT_SECRET) as any;

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
