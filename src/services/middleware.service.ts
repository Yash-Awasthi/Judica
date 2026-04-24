import logger from "../lib/logger.js";

/**
 * Middleware Hooks: intercept the deliberation pipeline at any stage.
 * Used for PII redaction, compliance checks, audit logging, etc.
 */

export type PipelineStage =
  | "pre_routing"
  | "post_routing"
  | "pre_deliberation"
  | "post_deliberation"
  | "pre_response"
  | "post_response"
  | "pre_memory_store"
  | "post_memory_store";

export interface MiddlewareContext {
  stage: PipelineStage;
  userId?: string;
  conversationId?: string;
  data: Record<string, unknown>;
  metadata: Record<string, unknown>;
}

export type MiddlewareFn = (ctx: MiddlewareContext) => Promise<MiddlewareContext>;

export interface MiddlewareHook {
  name: string;
  stage: PipelineStage;
  priority: number;
  handler: MiddlewareFn;
  enabled: boolean;
}

// ─── Middleware Registry ────────────────────────────────────────────────────

const hooks = new Map<string, MiddlewareHook>();
// Cap hooks map to prevent unbounded memory growth
const MAX_HOOKS = 500;

/**
 * Register a middleware hook.
 */
export function registerMiddleware(hook: Omit<MiddlewareHook, "enabled"> & { enabled?: boolean }): void {
  if (!hooks.has(hook.name) && hooks.size >= MAX_HOOKS) {
    throw new Error(`Middleware hook limit reached (max ${MAX_HOOKS})`);
  }
  hooks.set(hook.name, { ...hook, enabled: hook.enabled !== false });
  logger.info({ name: hook.name, stage: hook.stage, priority: hook.priority }, "Middleware registered");
}

/**
 * Remove a middleware hook.
 */
export function removeMiddleware(name: string): boolean {
  return hooks.delete(name);
}

/**
 * List all middleware hooks.
 */
export function listMiddleware(): MiddlewareHook[] {
  return [...hooks.values()].sort((a, b) => a.priority - b.priority);
}

/**
 * Clear all middleware (for testing).
 */
export function clearMiddleware(): void {
  hooks.clear();
}

/**
 * Enable/disable a middleware hook.
 */
export function setMiddlewareEnabled(name: string, enabled: boolean): boolean {
  const hook = hooks.get(name);
  if (!hook) return false;
  hook.enabled = enabled;
  return true;
}

// ─── Pipeline Execution ─────────────────────────────────────────────────────

/**
 * Run all middleware hooks for a given pipeline stage.
 * Hooks run in priority order (lower number = higher priority).
 * Each hook receives the context from the previous hook.
 */
export async function runMiddleware(
  stage: PipelineStage,
  initialCtx: Omit<MiddlewareContext, "stage">,
): Promise<MiddlewareContext> {
  let ctx: MiddlewareContext = { ...initialCtx, stage };

  const stageHooks = [...hooks.values()]
    .filter((h) => h.enabled && h.stage === stage)
    .sort((a, b) => a.priority - b.priority);

  for (const hook of stageHooks) {
    try {
      ctx = await hook.handler(ctx);
    } catch (err) {
      logger.error({ err, hookName: hook.name, stage }, "Middleware hook failed");
      // Continue with unmodified context on failure
    }
  }

  return ctx;
}

// ─── Built-in Middleware ────────────────────────────────────────────────────

/**
 * PII redaction middleware — redacts email addresses and phone numbers.
 */
export function piiRedactionMiddleware(): MiddlewareHook {
  return {
    name: "pii_redaction",
    stage: "pre_response",
    priority: 10,
    enabled: true,
    handler: async (ctx) => {
      const data = { ...ctx.data };

      if (typeof data.content === "string") {
        let content = data.content;
        // Use simpler, non-backtracking email regex to prevent ReDoS
        content = content.replace(
          /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z]{2,})+\b/g,
          "[EMAIL_REDACTED]",
        );
        // Redact phone numbers (basic patterns)
        content = content.replace(
          /\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/g,
          "[PHONE_REDACTED]",
        );
        data.content = content;
      }

      return { ...ctx, data };
    },
  };
}

/**
 * Audit logging middleware — logs all pipeline activity.
 */
export function auditLogMiddleware(
  logFn: (entry: Record<string, unknown>) => void = (entry) => logger.info(entry, "Audit log"),
): MiddlewareHook {
  return {
    name: "audit_log",
    stage: "post_response",
    priority: 100,
    enabled: true,
    handler: async (ctx) => {
      logFn({
        stage: ctx.stage,
        userId: ctx.userId,
        conversationId: ctx.conversationId,
        timestamp: new Date().toISOString(),
        dataKeys: Object.keys(ctx.data),
      });
      return ctx;
    },
  };
}

/**
 * Content length guard — blocks responses over a size limit.
 */
export function contentLengthGuard(maxChars: number = 50000): MiddlewareHook {
  return {
    name: "content_length_guard",
    stage: "pre_response",
    priority: 5,
    enabled: true,
    handler: async (ctx) => {
      const content = ctx.data.content;
      if (typeof content === "string" && content.length > maxChars) {
        return {
          ...ctx,
          data: {
            ...ctx.data,
            content: content.substring(0, maxChars) + "\n\n[Content truncated — exceeded maximum length]",
          },
          metadata: { ...ctx.metadata, truncated: true },
        };
      }
      return ctx;
    },
  };
}
