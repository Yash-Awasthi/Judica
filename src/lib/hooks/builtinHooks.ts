/**
 * Built-in hooks — pre-registered pipeline hooks for common cross-cutting concerns.
 *
 * Hooks registered here:
 *   - piiRedactionHook  (post:retrieval)  — strips PII from retrieved documents
 *   - rateLimitHook     (pre:query)       — checks per-user rate limits
 *   - auditHook         (post:llm)        — logs to audit table
 */

import { hooks } from "./hookRegistry.js";
import type { HookContext, HookFn } from "./hookRegistry.js";
import { detectPII } from "../pii.js";
import logger from "../logger.js";
import redis from "../redis.js";

// ─── PII Redaction Hook ────────────────────────────────────────────────────────

/**
 * post:retrieval hook — scans each retrieved document for PII and replaces
 * sensitive fields with redacted placeholders before the LLM sees them.
 * Documents with a risk score >= 50 are anonymized in-place.
 */
export const piiRedactionHook: HookFn = async (ctx: HookContext): Promise<HookContext> => {
  if (!ctx.documents || ctx.documents.length === 0) return ctx;

  const redactedDocuments = ctx.documents.map((doc) => {
    // Support both plain strings and objects with a content/text field
    if (typeof doc === "string") {
      const detection = detectPII(doc);
      if (detection.riskScore >= 50) {
        logger.debug(
          { userId: ctx.userId, types: detection.types, riskScore: detection.riskScore },
          "piiRedactionHook: document anonymized",
        );
        return detection.anonymized;
      }
      return doc;
    }

    if (doc && typeof doc === "object") {
      const record = doc as Record<string, unknown>;
      // Check common content field names
      for (const field of ["content", "text", "body", "chunk"]) {
        if (typeof record[field] === "string") {
          const detection = detectPII(record[field] as string);
          if (detection.riskScore >= 50) {
            logger.debug(
              { userId: ctx.userId, field, types: detection.types, riskScore: detection.riskScore },
              "piiRedactionHook: document field anonymized",
            );
            return { ...record, [field]: detection.anonymized };
          }
        }
      }
    }

    return doc;
  });

  return { ...ctx, documents: redactedDocuments };
};

// ─── Rate Limit Hook ───────────────────────────────────────────────────────────

/**
 * pre:query hook — checks a per-user sliding-window rate limit stored in Redis.
 * Default: 60 queries / minute per user.
 * Throws an error if the limit is exceeded so the pipeline aborts early.
 */
export const rateLimitHook: HookFn = async (ctx: HookContext): Promise<HookContext> => {
  if (!ctx.userId) return ctx; // Unauthenticated requests handled elsewhere

  const key = `hook:ratelimit:${ctx.userId}`;
  const windowSecs = 60;
  const maxRequests = 60;

  try {
    const count = await redis.incr(key);
    if (count === 1) {
      // First request in window — set TTL
      await redis.expire(key, windowSecs);
    }

    if (count > maxRequests) {
      const ttl = await redis.ttl(key);
      const err = new Error(`Rate limit exceeded: ${maxRequests} requests per minute allowed`);
      (err as Error & { statusCode?: number; retryAfter?: number }).statusCode = 429;
      (err as Error & { retryAfter?: number }).retryAfter = ttl > 0 ? ttl : windowSecs;
      throw err;
    }
  } catch (err) {
    // Re-throw rate limit errors; swallow Redis connectivity errors
    if ((err as Error & { statusCode?: number }).statusCode === 429) throw err;
    logger.warn({ err: (err as Error).message }, "rateLimitHook: Redis check failed — skipping");
  }

  return ctx;
};

// ─── Audit Hook ───────────────────────────────────────────────────────────────

/**
 * post:llm hook — writes a lightweight audit record after each LLM response.
 * Uses fire-and-forget to avoid blocking the response pipeline.
 */
export const auditHook: HookFn = async (ctx: HookContext): Promise<HookContext> => {
  // Fire-and-forget — never block or throw from audit logging
  Promise.resolve().then(async () => {
    try {
      const { logAudit } = await import("../audit.js");
      if (!ctx.userId) return;

      await logAudit({
        userId: ctx.userId,
        modelName: (ctx.metadata?.modelName as string) ?? "unknown",
        prompt: ctx.query ?? "",
        response: ctx.response ?? "",
        tokensIn: (ctx.metadata?.tokensIn as number) ?? 0,
        tokensOut: (ctx.metadata?.tokensOut as number) ?? 0,
        latencyMs: (ctx.metadata?.latencyMs as number) ?? 0,
        requestType: "unknown",
        success: !ctx.error,
        errorMessage: ctx.error?.message,
        metadata: {
          hookStage: "post:llm",
          tenantId: ctx.tenantId,
          ...ctx.metadata,
        },
      });
    } catch (err) {
      logger.warn({ err: (err as Error).message }, "auditHook: failed to write audit log");
    }
  }).catch(() => {});

  return ctx;
};

// ─── Registration ─────────────────────────────────────────────────────────────

/**
 * Register all built-in hooks with the global registry.
 * Called once at application startup.
 */
export function registerBuiltinHooks(): void {
  // Priority 10 — run early so later hooks see clean documents
  hooks.register("post:retrieval", piiRedactionHook, 10);

  // Priority 5 — run before anything else in pre:query
  hooks.register("pre:query", rateLimitHook, 5);

  // Priority 100 (default) — run after other post:llm hooks
  hooks.register("post:llm", auditHook, 100);

  logger.debug("Built-in hooks registered: piiRedactionHook, rateLimitHook, auditHook");
}
