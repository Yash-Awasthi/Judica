import { env } from "../config/env.js";
import type { FastifyError, FastifyRequest, FastifyReply } from "fastify";
import { ZodError } from "zod";
import logger from "../lib/logger.js";

// P4-09: Optional Sentry error tracking — only active when SENTRY_DSN is set.
// Lazy-initialized to avoid import cost when not configured.
let sentryReportError: ((err: Error, context?: Record<string, unknown>) => void) | null = null;

if (env.SENTRY_DSN) {
  // @ts-ignore - @sentry/node may not be installed
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
  // P8-51: Include request ID in error responses for log correlation (only when defined)
  const requestId = request.id;

  if (error instanceof AppError) {
    logger.warn({
      requestId,
      statusCode: error.statusCode,
      message: error.message,
      url: request.url,
    });
    const body: Record<string, unknown> = { error: error.message, code: error.code };
    if (requestId !== undefined) body.requestId = requestId;
    reply.code(error.statusCode).send(body);
    return;
  }

  // P8-50: Handle ZodError by name check to support plain objects from serialization boundaries
  if (error instanceof ZodError || (error as any).name === "ZodError") {
    // P52-05: Sanitize issues to prevent arbitrary data exposure from spoofed ZodError objects
    const rawIssues = (error as any).issues;
    const details = Array.isArray(rawIssues)
      ? rawIssues.map((i: any) => ({
          field: Array.isArray(i?.path) ? i.path.join(".") : "unknown",
          message: typeof i?.message === "string" ? i.message : "Validation error",
        }))
      : [{ field: "unknown", message: "Validation failed" }];
    const body: Record<string, unknown> = { error: "Validation failed", details };
    if (requestId !== undefined) body.requestId = requestId;
    reply.code(400).send(body);
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

  // In development, return the actual error message; in production, return a generic message.
  const message = env.NODE_ENV === "production" ? "Internal server error" : error.message || "Internal server error";
  const body: Record<string, unknown> = {
    error: message,
    code: "INTERNAL_ERROR",
  };
  if (requestId !== undefined) body.requestId = requestId;
  reply.code(500).send(body);
}
