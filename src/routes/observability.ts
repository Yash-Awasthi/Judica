/**
 * LLM Observability — Phase 8.15
 *
 * Exposes Langfuse integration status and allows manual trace scoring.
 *
 * Routes:
 *   GET  /observability/status      — Check if Langfuse is configured
 *   POST /observability/score       — Submit a user rating as a Langfuse score
 *   POST /observability/trace       — Create a trace manually (admin/debug)
 */

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  isLangfuseEnabled,
  scoreTrace,
  createTrace,
} from "../lib/langfuse.js";

const scoreSchema = z.object({
  traceId:  z.string().min(1).max(200),
  name:     z.string().min(1).max(100).optional().default("user_rating"),
  /** 0 = negative, 0.5 = neutral, 1 = positive */
  value:    z.number().min(0).max(1),
  comment:  z.string().max(500).optional(),
});

const traceSchema = z.object({
  traceId:   z.string().min(1).max(200),
  name:      z.string().min(1).max(200),
  sessionId: z.string().max(200).optional(),
  metadata:  z.record(z.unknown()).optional(),
});

export async function observabilityPlugin(app: FastifyInstance) {

  app.get("/observability/status", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    return {
      success:          true,
      langfuse:         {
        enabled:  isLangfuseEnabled(),
        host:     process.env.LANGFUSE_HOST ?? "https://cloud.langfuse.com",
        hasKeys:  Boolean(process.env.LANGFUSE_SECRET_KEY && process.env.LANGFUSE_PUBLIC_KEY),
      },
      opentelemetry: {
        enabled: process.env.OTEL_ENABLED === "true",
        endpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? null,
      },
      prometheus: { enabled: true, path: "/metrics" },
    };
  });

  app.post("/observability/score", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const parsed = scoreSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });

    const { traceId, name, value, comment } = parsed.data;
    await scoreTrace(traceId, name, value, comment);

    return {
      success:   true,
      traceId,
      submitted: isLangfuseEnabled(),
      message:   isLangfuseEnabled()
        ? "Score submitted to Langfuse"
        : "Langfuse not configured — score logged locally only",
    };
  });

  app.post("/observability/trace", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const parsed = traceSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });

    await createTrace({
      ...parsed.data,
      userId: String(userId),
    });

    return {
      success:   true,
      traceId:   parsed.data.traceId,
      submitted: isLangfuseEnabled(),
    };
  });
}
