import type { Response, NextFunction, RequestHandler } from "express";
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
