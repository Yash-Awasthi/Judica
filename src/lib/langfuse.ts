/**
 * Langfuse LLM Observability Integration — Phase 8.15
 *
 * Provides structured LLM tracing via Langfuse (MIT, langfuse/langfuse).
 * Falls back to a no-op implementation when LANGFUSE_SECRET_KEY is not set.
 *
 * Langfuse captures:
 * - Prompt/completion pairs per deliberation
 * - Token usage and cost per call
 * - Council member performance per session
 * - Latency across providers
 *
 * Configuration env vars:
 *   LANGFUSE_SECRET_KEY   — Langfuse project secret key
 *   LANGFUSE_PUBLIC_KEY   — Langfuse project public key
 *   LANGFUSE_HOST         — Self-hosted host (default: https://cloud.langfuse.com)
 *
 * Ref: https://langfuse.com/docs/sdk/typescript
 */

import logger from "./logger.js";

const LANGFUSE_SECRET = process.env.LANGFUSE_SECRET_KEY;
const LANGFUSE_PUBLIC = process.env.LANGFUSE_PUBLIC_KEY;
const LANGFUSE_HOST   = process.env.LANGFUSE_HOST ?? "https://cloud.langfuse.com";

// ─── Types ─────────────────────────────────────────────────────────────────

export interface LLMTrace {
  traceId:   string;
  name:      string;
  userId?:   string;
  sessionId?: string;
  metadata?: Record<string, unknown>;
}

export interface LLMGeneration {
  traceId:          string;
  name:             string;
  model:            string;
  provider:         string;
  prompt:           Array<{ role: string; content: string }>;
  completion:       string;
  promptTokens?:    number;
  completionTokens?: number;
  latencyMs?:       number;
  metadata?:        Record<string, unknown>;
}

// ─── Langfuse HTTP client (no SDK dependency) ─────────────────────────────

const HEADERS = () => ({
  "Content-Type": "application/json",
  Authorization: `Basic ${Buffer.from(`${LANGFUSE_PUBLIC}:${LANGFUSE_SECRET}`).toString("base64")}`,
});

async function post(path: string, body: unknown): Promise<void> {
  if (!LANGFUSE_SECRET || !LANGFUSE_PUBLIC) return; // no-op when unconfigured

  try {
    const res = await fetch(`${LANGFUSE_HOST}${path}`, {
      method:  "POST",
      headers: HEADERS(),
      body:    JSON.stringify(body),
      signal:  AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      logger.warn({ status: res.status, path }, "Langfuse: upload failed");
    }
  } catch (err) {
    logger.warn({ err }, "Langfuse: network error (non-blocking)");
  }
}

// ─── Public API ────────────────────────────────────────────────────────────

/** Create a top-level trace (e.g. one per deliberation session) */
export async function createTrace(trace: LLMTrace): Promise<void> {
  await post("/api/public/traces", {
    id:        trace.traceId,
    name:      trace.name,
    userId:    trace.userId,
    sessionId: trace.sessionId,
    metadata:  trace.metadata ?? {},
    timestamp: new Date().toISOString(),
  });
}

/** Log a single LLM generation event (one per council member call) */
export async function logGeneration(gen: LLMGeneration): Promise<void> {
  await post("/api/public/generations", {
    traceId:             gen.traceId,
    name:                gen.name,
    startTime:           new Date(Date.now() - (gen.latencyMs ?? 0)).toISOString(),
    endTime:             new Date().toISOString(),
    model:               gen.model,
    modelParameters:     { provider: gen.provider },
    prompt:              gen.prompt,
    completion:          gen.completion,
    usage: {
      promptTokens:     gen.promptTokens ?? 0,
      completionTokens: gen.completionTokens ?? 0,
      totalTokens:      (gen.promptTokens ?? 0) + (gen.completionTokens ?? 0),
    },
    metadata:            gen.metadata ?? {},
  });
}

/** Score a trace (e.g. after user rates the deliberation) */
export async function scoreTrace(
  traceId: string,
  name: string,
  value: number,        // 0–1
  comment?: string,
): Promise<void> {
  await post("/api/public/scores", {
    traceId,
    name,
    value,
    comment,
    timestamp: new Date().toISOString(),
  });
}

/** Returns true if Langfuse is configured and enabled */
export function isLangfuseEnabled(): boolean {
  return Boolean(LANGFUSE_SECRET && LANGFUSE_PUBLIC);
}
