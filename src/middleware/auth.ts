import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { env } from "../config/env.js";

export interface AuthRequest extends Request {
  userId?: number;
  username?: string;
}

export function requireAuth(req: AuthRequest, res: Response, next: NextFunction) {
  const auth = req.headers.authorization?.split(" ")[1];
  if (!auth) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  try {
    const payload = jwt.verify(auth, env.JWT_SECRET) as any;
    req.userId = payload.userId;
    req.username = payload.username;
    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired token" });
  }
}

export function optionalAuth(req: AuthRequest, res: Response, next: NextFunction) {
  const auth = req.headers.authorization?.split(" ")[1];
  if (!auth) { next(); return; }
  try {
    const payload = jwt.verify(auth, env.JWT_SECRET) as any;
    req.userId = payload.userId;
    req.username = payload.username;
  } catch {
    // invalid token — treat as guest, don't block
  }
  next();
}