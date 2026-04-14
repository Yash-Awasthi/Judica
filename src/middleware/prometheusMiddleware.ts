import { Request, Response, NextFunction } from "express";
import type { FastifyRequest, FastifyReply } from "fastify";
import { httpRequestDuration, httpRequestTotal } from "../lib/prometheusMetrics.js";

export function prometheusMiddleware(req: Request, res: Response, next: NextFunction) {
  const end = httpRequestDuration.startTimer();

  res.on("finish", () => {
    const route = req.route?.path || req.path;
    const labels = {
      method: req.method,
      route,
      status_code: String(res.statusCode),
    };
    end(labels);
    httpRequestTotal.inc(labels);
  });

  next();
}

// ---------- Fastify-native version ----------

export async function fastifyPrometheusOnRequest(request: FastifyRequest, reply: FastifyReply) {
  (request as any).metricsTimer = httpRequestDuration.startTimer();
}

export async function fastifyPrometheusOnResponse(request: FastifyRequest, reply: FastifyReply) {
  const timer = (request as any).metricsTimer;
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
