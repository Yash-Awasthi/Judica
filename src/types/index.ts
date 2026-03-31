import { Request } from "express";

export interface AuthRequest extends Request {
  userId?: number;
  username?: string;
  requestId?: string;
}
