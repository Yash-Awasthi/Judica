import { randomUUID } from "crypto";
import { Request, Response, NextFunction } from "express";
import type { FastifyRequest, FastifyReply } from "fastify";

export function requestId(req: Request, res: Response, next: NextFunction) {
  const id = (req.headers["x-request-id"] as string) || randomUUID();
  (req as any).requestId = id;
  res.locals.requestId = id;
  res.setHeader("X-Request-ID", id);
  next();
}

// ---------- Fastify-native version ----------

export async function fastifyRequestId(request: FastifyRequest, reply: FastifyReply) {
  const id = (request.headers["x-request-id"] as string) || randomUUID();
  (request as any).requestId = id;
  reply.header("X-Request-ID", id);
}