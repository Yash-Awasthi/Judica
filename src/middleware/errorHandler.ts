import { env } from "../config/env.js";
import type { FastifyError, FastifyRequest, FastifyReply } from "fastify";
import { ZodError } from "zod";
import logger from "../lib/logger.js";

// P4-09: Optional Sentry error tracking — only active when SENTRY_DSN is set.
// Lazy-initialized to avoid import cost when not configured.
let sentryReportError: ((err: Error, context?: Record<string, unknown>) => void) | null = null;

if (env.SENTRY_DSN) {
  import("@sentry/node").then((Sentry) => {
    Sentry.init({
      dsn: env.SENTRY_DSN,
      environment: env.NODE_ENV,
      tracesSampleRate: env.NODE_ENV === "production" ? 0.1 : 1.0,
    });
    sentryReportError = (err, context) => {
      Sentry.captureException(err, { extra: context });
    };
    logger.info("Sentry error tracking initialized");
  }).catch((e) => {
    logger.warn({ err: (e as Error).message }, "Sentry not available — install @sentry/node to enable error tracking");
  });
}

// P8-52: Removed dead isOperational flag — was checked but never meaningfully used.
// AppError is always operational by definition; unexpected errors are always non-operational.
export class AppError extends Error {
  constructor(
    public statusCode: number,
    public message: string,
    public code: string = 'INTERNAL_ERROR',
  ) {
    super(message);
    Object.setPrototypeOf(this, AppError.prototype);
  }
}

export function fastifyErrorHandler(error: FastifyError | Error, request: FastifyRequest, reply: FastifyReply) {
  // P8-51: Include request ID in all error responses for log correlation
  const requestId = request.id;

  if (error instanceof AppError) {
    logger.warn({
      requestId,
      statusCode: error.statusCode,
      message: error.message,
      url: request.url,
    });
    reply.code(error.statusCode).send({ error: error.message, code: error.code, requestId });
    return;
  }

  // P8-50: Use instanceof ZodError instead of string-based name check (spoofable)
  if (error instanceof ZodError) {
    reply.code(400).send({ error: "Validation failed", details: error.issues, requestId });
    return;
  }

  logger.error({ err: error, requestId, url: request.url, method: request.method }, "Unhandled error");

  // P4-09: Report unhandled errors to Sentry if configured
  if (sentryReportError) {
    sentryReportError(error instanceof Error ? error : new Error(String(error)), {
      requestId,
      url: request.url,
      method: request.method,
      userId: (request as unknown as { userId?: number }).userId,
    });
  }

  // P8-49: Always return generic message for unexpected errors — not just in production.
  reply.code(500).send({
    error: "Internal server error",
    code: "INTERNAL_ERROR",
    requestId,
  });
}
