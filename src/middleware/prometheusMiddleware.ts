import type { FastifyRequest, FastifyReply } from "fastify";
import { httpRequestDuration, httpRequestTotal } from "../lib/prometheusMetrics.js";

export async function fastifyPrometheusOnRequest(request: FastifyRequest, _reply: FastifyReply) {
  (request as unknown as { metricsTimer: ReturnType<typeof httpRequestDuration.startTimer> }).metricsTimer = httpRequestDuration.startTimer();

  // P8-58: Clean up histogram timer on connection abort to prevent leaked references
  request.raw.on("close", () => {
    const timer = (request as unknown as { metricsTimer?: ReturnType<typeof httpRequestDuration.startTimer> }).metricsTimer;
    if (timer) {
      const route = request.routeOptions?.url || "unmatched";
      timer({ method: request.method, route, status_code: "499" }); // 499 = client closed
      (request as unknown as { metricsTimer?: unknown }).metricsTimer = undefined;
    }
  });
}

export async function fastifyPrometheusOnResponse(request: FastifyRequest, reply: FastifyReply) {
  const timer = (request as unknown as { metricsTimer?: ReturnType<typeof httpRequestDuration.startTimer> }).metricsTimer;
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
    (request as unknown as { metricsTimer?: unknown }).metricsTimer = undefined;
  }
}
