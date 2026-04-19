import { randomUUID } from "crypto";
import { db } from "../lib/drizzle.js";
import { traces } from "../db/schema/traces.js";
import logger from "../lib/logger.js";


export interface TraceStep {
  name: string;
  type: "llm_call" | "tool_call" | "embedding" | "retrieval" | "synthesis";
  input: string;
  output: string;
  model?: string;
  tokens?: number;
  latencyMs: number;
  error?: string;
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
  ctx.steps.push({
    ...step,
    latencyMs: step.latencyMs ?? 0,
  });
}

export async function endTrace(ctx: TraceContext): Promise<string> {
  const totalLatencyMs = Date.now() - ctx.startTime;
  const totalTokens = ctx.steps.reduce((sum, s) => sum + (s.tokens ?? 0), 0);
  // Rough average cost: $0.000005 per token
  const totalCostUsd = totalTokens * 0.000005;

  try {
    const [trace] = await db.insert(traces).values({
      id: ctx.id,
      userId: ctx.userId,
      type: ctx.type,
      conversationId: ctx.conversationId ?? null,
      workflowRunId: ctx.workflowRunId ?? null,
      steps: ctx.steps as unknown as Record<string, unknown>[],
      totalLatencyMs,
      totalTokens,
      totalCostUsd,
    }).returning();

    // Optional LangFuse integration
    await sendToLangfuse(ctx, trace.id, totalLatencyMs, totalTokens, totalCostUsd);

    return trace.id;
  } catch (err) {
    logger.error({ err, traceId: ctx.id }, "Failed to save trace");
    return ctx.id;
  }
}


async function sendToLangfuse(
  ctx: TraceContext,
  traceId: string,
  totalLatencyMs: number,
  totalTokens: number,
  totalCostUsd: number
): Promise<void> {
  if (!process.env.LANGFUSE_SECRET_KEY) return;

  try {
    const { Langfuse } = await import("langfuse");
    const langfuse = new Langfuse({
      secretKey: process.env.LANGFUSE_SECRET_KEY,
      publicKey: process.env.LANGFUSE_PUBLIC_KEY || "",
      baseUrl: process.env.LANGFUSE_BASE_URL || "https://cloud.langfuse.com",
    });

    const trace = langfuse.trace({
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

    for (const step of ctx.steps) {
      if (step.type === "llm_call") {
        trace.generation({
          name: step.name,
          model: step.model,
          input: step.input,
          output: step.output,
          usage: { totalTokens: step.tokens },
        });
      } else {
        trace.span({
          name: step.name,
          input: { content: step.input },
          output: { content: step.output },
        });
      }
    }

    await (langfuse as unknown as { shutdownAsync(): Promise<void> }).shutdownAsync();
  } catch {
    // Langfuse is optional — never break if it's not installed or fails
  }
}
