import type { FastifyRequest, FastifyReply } from "fastify";
import { httpRequestDuration, httpRequestTotal } from "../lib/prometheusMetrics.js";

// P58-10: Augment Fastify request type for metrics timer
declare module "fastify" {
  interface FastifyRequest {
    metricsTimer?: ReturnType<typeof httpRequestDuration.startTimer>;
    metricsCloseHandler?: () => void;
  }
}

export async function fastifyPrometheusOnRequest(request: FastifyRequest, _reply: FastifyReply) {
  request.metricsTimer = httpRequestDuration.startTimer();

  // P8-58: Clean up histogram timer on connection abort to prevent leaked references
  const closeHandler = () => {
    const timer = request.metricsTimer;
    if (timer) {
      const route = request.routeOptions?.url || "unmatched";
      timer({ method: request.method, route, status_code: "499" }); // 499 = client closed
      request.metricsTimer = undefined;
    }
  };
  request.raw.on("close", closeHandler);
  // P58-05: Store handler ref for cleanup in onResponse
  request.metricsCloseHandler = closeHandler;
}

export async function fastifyPrometheusOnResponse(request: FastifyRequest, reply: FastifyReply) {
  // P58-05: Remove close handler to prevent stale references
  const closeHandler = request.metricsCloseHandler;
  if (closeHandler) {
    request.raw.removeListener("close", closeHandler);
    request.metricsCloseHandler = undefined;
  }

  const timer = request.metricsTimer;
  if (timer) {
    // P0-46: Use routeOptions.url (the route pattern like "/ask/:id") instead of
    // request.url (the actual URL like "/ask/12345") to prevent high-cardinality labels
    const route = request.routeOptions?.url || "unmatched";
    const labels = {
      method: request.method,
      route,
      status_code: String(reply.statusCode),
    };
    timer(labels);
    httpRequestTotal.inc(labels);
    // P8-58: Clear timer reference after use
    request.metricsTimer = undefined;
  }
}
