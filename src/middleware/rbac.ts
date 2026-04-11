import type { Response, NextFunction, RequestHandler } from "express";
import type { AuthRequest } from "../types/index.js";
import { AppError } from "./errorHandler.js";
import prisma from "../lib/db.js";

export function requireRole(...roles: string[]): RequestHandler {
  return async (req: AuthRequest, _res: Response, next: NextFunction) => {
    if (!req.userId) throw new AppError(401, "Not authenticated", "AUTH_REQUIRED");

    const user = await prisma.user.findUnique({
      where: { id: req.userId },
      select: { role: true },
    });

    if (!user || !roles.includes(user.role)) {
      throw new AppError(403, "Insufficient permissions", "FORBIDDEN");
    }

    next();
  };
}

export function requireOwnership(resourceField: string = "userId"): RequestHandler {
  return (req: AuthRequest, _res: Response, next: NextFunction) => {
    const resource = (req as any).resource;
    if (resource && resource[resourceField] !== req.userId) {
      throw new AppError(403, "Not the owner", "FORBIDDEN");
    }
    next();
  };
}
