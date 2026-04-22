import { AsyncLocalStorage } from "async_hooks";

// P9-86: Enriched request context — carries userId, traceId, tenantId alongside requestId
// so downstream code doesn't need to re-fetch from the request object.
export interface RequestContext {
  readonly requestId: string;
  // P9-51: OTEL trace/span correlation — injected by tracing middleware
  readonly traceId?: string;
  readonly spanId?: string;
  // P9-86: User and tenant context for downstream access
  readonly userId?: number;
  readonly tenantId?: string;
  readonly userRole?: string;
}

export const requestContext = new AsyncLocalStorage<RequestContext>();

// P9-87: Helper for context-wrapped execution — eliminates manual store.run() boilerplate
export function withContext<T>(ctx: RequestContext, fn: () => T): T {
  return requestContext.run(ctx, fn);
}

// P56-08: DEPRECATED — withContext already handles async functions correctly.
// Kept for backward compatibility; prefer withContext for new code.
/** @deprecated Use withContext instead — it handles both sync and async. */
export function withContextAsync<T>(ctx: RequestContext, fn: () => Promise<T>): Promise<T> {
  return withContext(ctx, fn);
}

// P9-88: Context is now immutable via `readonly` properties on the interface.
// To "update" context (e.g., add userId after auth), create a new context object:
//   const newCtx = { ...currentCtx, userId: 123 };
//   return withContext(newCtx, () => next());
// This ensures side effects are explicit and visible to callers.

// Helper to get current context or throw
export function getContextOrThrow(): RequestContext {
  const ctx = requestContext.getStore();
  if (!ctx) throw new Error("No request context available — ensure middleware has initialized context");
  return ctx;
}
