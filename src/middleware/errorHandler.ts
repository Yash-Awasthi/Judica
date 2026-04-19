import { env } from "../config/env.js";
import type { FastifyError, FastifyRequest, FastifyReply } from "fastify";
import logger from "../lib/logger.js";

export class AppError extends Error {
  constructor(
    public statusCode: number,
    public message: string,
    public code: string = 'INTERNAL_ERROR',
    public isOperational = true
  ) {
    super(message);
    Object.setPrototypeOf(this, AppError.prototype);
  }
}

export function fastifyErrorHandler(error: FastifyError | Error, request: FastifyRequest, reply: FastifyReply) {
  if (error instanceof AppError) {
    logger.warn({
      statusCode: error.statusCode,
      message: error.message,
      url: request.url,
    });
    reply.code(error.statusCode).send({ error: error.message, code: error.code });
    return;
  }

  const zodError = error as { name?: string; issues?: unknown[] };
  if (zodError.name === "ZodError" || zodError.issues) {
    reply.code(400).send({ error: "Validation failed", details: zodError.issues });
    return;
  }

  logger.error({ err: error, url: request.url, method: request.method }, "Unhandled error");
  reply.code(500).send({
    error: env.NODE_ENV === "production" ? "Internal server error" : error.message,
    code: "INTERNAL_ERROR",
  });
}
