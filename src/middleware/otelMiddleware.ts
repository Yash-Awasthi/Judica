import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from "fastify";
import { trace, SpanStatusCode } from "@opentelemetry/api";
import { requestContext } from "../lib/context.js";

// Augment Fastify request type for OTEL span tracking
declare module "fastify" {
  interface FastifyRequest {
    otelSpan?: ReturnType<ReturnType<typeof trace.getTracer>["startSpan"]>;
  }
}

/**
 * Fastify plugin that adds a request span for each incoming HTTP request.
 * Attaches: http.method, http.url, http.route, http.status_code, user.id (if authed)
 * Injects the trace ID into the response as X-Trace-ID.
 * No-op when OTEL_ENABLED is not true.
 */
const otelMiddlewarePlugin: FastifyPluginAsync = async (fastify) => {
  const enabled = process.env.OTEL_ENABLED === "true";
  if (!enabled) return;

  let tracer: ReturnType<typeof trace.getTracer>;
  try {
    const { tracer: otelTracer } = await import("../lib/otel.js");
    tracer = otelTracer;
  } catch {
    // OTEL not initialized — skip
    return;
  }

  fastify.addHook("onRequest", async (request: FastifyRequest, reply: FastifyReply) => {
    const spanName = `HTTP ${request.method}`;
    const span = tracer.startSpan(spanName, {
      attributes: {
        "http.method": request.method,
        "http.url": request.url.split("?")[0], // Strip query string to reduce cardinality
        "http.host": request.hostname,
        "http.scheme": request.protocol,
        "http.flavor": "1.1",
      },
    });

    // Store span on request for later enrichment
    request.otelSpan = span;

    // Inject trace ID into response header immediately so it's available even on abort
    const traceId = span.spanContext().traceId;
    if (traceId) {
      reply.header("X-Trace-ID", traceId);

      // Enrich the AsyncLocalStorage context with the trace/span IDs so
      // logger mixin picks them up automatically (logger.ts already reads ctx.traceId)
      const currentCtx = requestContext.getStore();
      if (currentCtx) {
        requestContext.enterWith({
          ...currentCtx,
          traceId,
          spanId: span.spanContext().spanId || undefined,
        });
      }
    }
  });

  fastify.addHook("onResponse", async (request: FastifyRequest, reply: FastifyReply) => {
    const span = request.otelSpan;
    if (!span) return;

    // Attach route pattern (low cardinality) and status code
    const route = request.routeOptions?.url || "unmatched";
    span.setAttributes({
      "http.route": route,
      "http.status_code": reply.statusCode,
    });

    // Attach authenticated user ID if present
    const userId = request.userId;
    if (userId !== undefined) {
      span.setAttribute("user.id", userId);
    }

    // Mark span as error for 5xx responses
    if (reply.statusCode >= 500) {
      span.setStatus({ code: SpanStatusCode.ERROR, message: `HTTP ${reply.statusCode}` });
    } else {
      span.setStatus({ code: SpanStatusCode.OK });
    }

    span.end();
    request.otelSpan = undefined;
  });

  // Ensure span is ended on connection errors / premature close
  fastify.addHook("onError", async (request: FastifyRequest, _reply: FastifyReply, error: Error) => {
    const span = request.otelSpan;
    if (!span) return;

    span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
    span.recordException(error);
    span.end();
    request.otelSpan = undefined;
  });
};

export default otelMiddlewarePlugin;
