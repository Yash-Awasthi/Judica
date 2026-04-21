import { randomUUID } from "crypto";
import { db } from "../lib/drizzle.js";
import { traces } from "../db/schema/traces.js";
import logger from "../lib/logger.js";
import { env } from "../config/env.js";
import { calculateCost } from "../lib/cost.js";

// P4-08: Log OTEL endpoint availability at startup
if (env.OTEL_EXPORTER_OTLP_ENDPOINT) {
  logger.info({ endpoint: env.OTEL_EXPORTER_OTLP_ENDPOINT }, "OTEL exporter endpoint configured");
} else {
  logger.debug("OTEL exporter not configured — traces will be stored in database only");
}

// P9-100: Module-level Langfuse singleton — avoid per-request reinitialization
let langfuseInstance: unknown = null;
let langfuseInitAttempted = false;

async function getLangfuse(): Promise<unknown | null> {
  if (!process.env.LANGFUSE_SECRET_KEY) return null;
  if (langfuseInitAttempted) return langfuseInstance;
  langfuseInitAttempted = true;

  try {
    const { Langfuse } = await import("langfuse");
    langfuseInstance = new Langfuse({
      secretKey: process.env.LANGFUSE_SECRET_KEY,
      publicKey: process.env.LANGFUSE_PUBLIC_KEY || "",
      baseUrl: process.env.LANGFUSE_BASE_URL || "https://cloud.langfuse.com",
    });
    logger.info("Langfuse client initialized (singleton)");
    return langfuseInstance;
  } catch {
    logger.debug("Langfuse not available — tracing will be DB-only");
    return null;
  }
}

export interface TraceStep {
  name: string;
  type: "llm_call" | "tool_call" | "embedding" | "retrieval" | "synthesis";
  input: string;
  output: string;
  model?: string;
  tokens?: number;
  // P9-102: Track input/output tokens separately for accurate cost attribution
  inputTokens?: number;
  outputTokens?: number;
  latencyMs: number;
  error?: string;
  // P9-98: Parent-child span hierarchy
  parentStepName?: string;
}

export interface TraceContext {
  id: string;
  userId: number;
  type: string;
  conversationId?: string;
  workflowRunId?: string;
  steps: TraceStep[];
  startTime: number;
}


export function startTrace(
  userId: number,
  type: string,
  opts?: { conversationId?: string; workflowRunId?: string }
): TraceContext {
  return {
    id: randomUUID(),
    userId,
    type,
    conversationId: opts?.conversationId,
    workflowRunId: opts?.workflowRunId,
    steps: [],
    startTime: Date.now(),
  };
}

export function addStep(
  ctx: TraceContext,
  step: Omit<TraceStep, "latencyMs"> & { latencyMs?: number }
): void {
  // P9-103: Use -1 to indicate missing instrumentation (not 0 which looks healthy)
  const latencyMs = step.latencyMs ?? -1;
  if (latencyMs < 0) {
    logger.debug({ step: step.name, traceId: ctx.id }, "Trace step missing latency instrumentation");
  }
  ctx.steps.push({
    ...step,
    latencyMs,
  });
}

// P9-99: Trace persistence is now fire-and-forget (non-blocking on request path).
// The returned promise resolves immediately with the traceId; DB write happens async.
export function endTrace(ctx: TraceContext): string {
  const totalLatencyMs = Date.now() - ctx.startTime;
  const totalTokens = ctx.steps.reduce((sum, s) => sum + (s.tokens ?? 0), 0);

  // P9-105: Use the canonical cost calculator from lib/cost.ts instead of a separate formula.
  // Aggregate input/output tokens across steps for accurate per-model pricing.
  let totalCostUsd = 0;
  for (const step of ctx.steps) {
    if (step.model && (step.inputTokens || step.outputTokens)) {
      // P9-102: Use per-token granularity when available
      totalCostUsd += calculateCost("unknown", step.model, step.inputTokens ?? 0, step.outputTokens ?? 0);
    } else if (step.tokens) {
      // Fallback: assume 60/40 input/output split for legacy steps without granularity
      totalCostUsd += calculateCost("unknown", step.model ?? "unknown", Math.round(step.tokens * 0.6), Math.round(step.tokens * 0.4));
    }
  }

  // P9-99: Fire-and-forget — don't await DB write on the request path
  void persistTrace(ctx, totalLatencyMs, totalTokens, totalCostUsd);

  return ctx.id;
}

// P9-99: Async persistence decoupled from request lifecycle
async function persistTrace(
  ctx: TraceContext,
  totalLatencyMs: number,
  totalTokens: number,
  totalCostUsd: number
): Promise<void> {
  try {
    await db.insert(traces).values({
      id: ctx.id,
      userId: ctx.userId,
      type: ctx.type,
      conversationId: ctx.conversationId ?? null,
      workflowRunId: ctx.workflowRunId ?? null,
      steps: ctx.steps as unknown as Record<string, unknown>[],
      totalLatencyMs,
      totalTokens,
      totalCostUsd,
    });

    // Optional LangFuse integration
    await sendToLangfuse(ctx, ctx.id, totalLatencyMs, totalTokens, totalCostUsd);
  } catch (err) {
    logger.error({ err, traceId: ctx.id }, "Failed to save trace");
  }
}


// P9-104: Typed Langfuse interfaces to replace unsafe `as any` / `as unknown as` casts
interface LangfuseTrace {
  span: (opts: Record<string, unknown>) => unknown;
  generation: (opts: Record<string, unknown>) => unknown;
}

interface LangfuseClient {
  trace: (opts: Record<string, unknown>) => LangfuseTrace;
  flushAsync?: () => Promise<void>;
}

async function sendToLangfuse(
  ctx: TraceContext,
  traceId: string,
  totalLatencyMs: number,
  totalTokens: number,
  totalCostUsd: number
): Promise<void> {
  // P9-100: Use singleton client instead of creating new instance per request
  const langfuse = await getLangfuse();
  if (!langfuse) return;

  try {
    // P9-104: Use typed interface instead of unsafe casts
    const client = langfuse as LangfuseClient;
    const trace = client.trace({
      id: traceId,
      name: ctx.type,
      userId: String(ctx.userId),
      metadata: {
        conversationId: ctx.conversationId,
        workflowRunId: ctx.workflowRunId,
        totalLatencyMs,
        totalTokens,
        totalCostUsd,
      },
    });

    // P9-98: Build span hierarchy — steps with parentStepName are nested under their parent
    for (const step of ctx.steps) {
      const spanOpts: Record<string, unknown> = {
        name: step.name,
        ...(step.parentStepName ? { parentObservationId: step.parentStepName } : {}),
      };

      if (step.type === "llm_call") {
        trace.generation({
          ...spanOpts,
          model: step.model,
          input: step.input,
          output: step.output,
          // P9-102: Report input/output token granularity
          usage: {
            totalTokens: step.tokens,
            ...(step.inputTokens !== undefined ? { promptTokens: step.inputTokens } : {}),
            ...(step.outputTokens !== undefined ? { completionTokens: step.outputTokens } : {}),
          },
        });
      } else {
        trace.span({
          ...spanOpts,
          input: { content: step.input },
          output: { content: step.output },
        });
      }
    }

    // P9-100: Flush without shutting down the singleton client
    await (client.flushAsync?.() ?? Promise.resolve());
  } catch (err) {
    // P9-101: Log export failures instead of silently dropping them
    logger.warn({ err: (err as Error).message, traceId }, "Langfuse export failed — trace saved to DB only");
  }
}

/**
 * P20-09: Graceful shutdown hook for Langfuse client.
 * Call this during process shutdown to flush pending traces and release resources.
 */
export async function shutdownTracer(): Promise<void> {
  if (!langfuseInstance) return;
  try {
    const client = langfuseInstance as LangfuseClient;
    await (client.flushAsync?.() ?? Promise.resolve());
    logger.info("Langfuse client flushed on shutdown");
  } catch (err) {
    logger.warn({ err: (err as Error).message }, "Langfuse flush on shutdown failed");
  } finally {
    langfuseInstance = null;
    langfuseInitAttempted = false;
  }
}
