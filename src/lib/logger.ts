import pino from "pino";
import { requestContext } from "./context.js";

const isDev = process.env.NODE_ENV !== "production";

// Log Transport Configuration
// ─────────────────────────────────────
// Production: Structured JSON to stdout (default pino behavior).
// Container orchestrators (K8s, ECS) capture stdout and forward to aggregators.
//
// To add a dedicated transport (e.g., Loki, OTLP, Datadog):
//   1. Install transport package: `pino-loki`, `pino-opentelemetry-transport`, etc.
//   2. Set LOG_TRANSPORT env var to the target name
//   3. Uncomment the transport block below:
//
//   transport: !isDev && process.env.LOG_TRANSPORT
//     ? { target: process.env.LOG_TRANSPORT, options: { /* transport-specific */ } }
//     : isDev ? { target: "pino-pretty", ... } : undefined
//
// Current setup: stdout JSON in prod, pino-pretty in dev.

// Log Sampling Strategy
// ─────────────────────────────
// Under high load, logging every request creates I/O pressure.
// Recommended approaches (implement when traffic exceeds ~1000 req/s):
//   1. Use Pino's `level` set to "info" in prod (already done — skips debug/trace)
//   2. For request-level sampling, use a preHandler that sets `req.log.level` to
//      "silent" for a percentage of requests (e.g., log 10% of 200 OK responses)
//   3. For health check endpoints (/healthz, /readyz), always set level to "silent"
//   4. Consider pino-roll or log rotation for disk-based setups

// Redact sensitive fields that may appear in logged objects.
// Pino replaces matched paths with "[Redacted]" before serialization.
const redactPaths = [
  "password",
  "passwordHash",
  "token",
  "tokenHash",
  "refreshToken",
  "accessToken",
  "authorization",
  "cookie",
  "apiKey",
  "authKey",
  "secret",
  "privateKey",
  "sessionToken",
  "req.headers.authorization",
  "req.headers.cookie",
  "req.headers[\"x-api-key\"]",
];

const logger = pino({
  level: isDev ? "debug" : "info",
  // Prevent sensitive data from leaking into log output
  redact: {
    paths: redactPaths,
    censor: "[Redacted]",
  },
  // Inject traceId/spanId into every log record for OTEL correlation
  mixin() {
    const ctx = requestContext.getStore();
    if (!ctx) return {};
    const fields: Record<string, string> = { requestId: ctx.requestId };
    if (ctx.traceId) fields.traceId = ctx.traceId;
    if (ctx.spanId) fields.spanId = ctx.spanId;
    return fields;
  },
  // pino-pretty is synchronous and must ONLY be used in development.
  // The isDev guard ensures production never loads this blocking transport.
  transport: isDev
    ? { target: "pino-pretty", options: { colorize: true, ignore: "pid,hostname" } }
    : undefined,
});

export default logger;