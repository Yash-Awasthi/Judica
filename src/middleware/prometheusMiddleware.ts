import type { FastifyRequest, FastifyReply } from "fastify";
import { httpRequestDuration, httpRequestTotal } from "../lib/prometheusMetrics.js";

export async function fastifyPrometheusOnRequest(request: FastifyRequest, _reply: FastifyReply) {
  (request as unknown as { metricsTimer: ReturnType<typeof httpRequestDuration.startTimer> }).metricsTimer = httpRequestDuration.startTimer();
}

export async function fastifyPrometheusOnResponse(request: FastifyRequest, reply: FastifyReply) {
  const timer = (request as unknown as { metricsTimer?: ReturnType<typeof httpRequestDuration.startTimer> }).metricsTimer;
  if (timer) {
    const route = request.routeOptions?.url || request.url;
    const labels = {
      method: request.method,
      route,
      status_code: String(reply.statusCode),
    };
    timer(labels);
    httpRequestTotal.inc(labels);
  }
}
