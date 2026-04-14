import type { Response, NextFunction, RequestHandler } from "express";
import type { FastifyRequest, FastifyReply } from "fastify";
import type { AuthRequest } from "../types/index.js";
import { AppError } from "./errorHandler.js";
import { db } from "../lib/drizzle.js";
import { users } from "../db/schema/users.js";
import { eq } from "drizzle-orm";

export function requireRole(...roles: string[]): RequestHandler {
  return async (req: AuthRequest, _res: Response, next: NextFunction) => {
    try {
      if (!req.userId) throw new AppError(401, "Not authenticated", "AUTH_REQUIRED");

      const [user] = await db
        .select({ role: users.role })
        .from(users)
        .where(eq(users.id, req.userId))
        .limit(1);

      if (!user || !roles.includes(user.role)) {
        throw new AppError(403, "Insufficient permissions", "FORBIDDEN");
      }

      next();
    } catch (err) {
      next(err);
    }
  };
}

// ---------- Fastify-native version ----------

export function fastifyRequireRole(...roles: string[]) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    if (!(request as any).userId) {
      reply.code(401).send({ error: "Not authenticated", code: "AUTH_REQUIRED" });
      return;
    }

    const [user] = await db
      .select({ role: users.role })
      .from(users)
      .where(eq(users.id, (request as any).userId))
      .limit(1);

    if (!user || !roles.includes(user.role)) {
      reply.code(403).send({ error: "Insufficient permissions", code: "FORBIDDEN" });
      return;
    }
  };
}
