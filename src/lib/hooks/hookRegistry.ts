/**
 * Hook/Extension System — inject custom logic at pipeline stages.
 *
 * Hooks run in priority order (lower number = runs first).
 * Each hook receives a HookContext and returns a (possibly mutated) HookContext.
 * Throwing inside a hook marks the stage as failed and propagates the error.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export type HookStage =
  | "pre:query"       // before search/ask
  | "post:retrieval"  // after documents retrieved
  | "pre:llm"        // before LLM call
  | "post:llm"       // after LLM response
  | "pre:response"   // before sending to client
  | "on:error";       // on any pipeline error

export interface HookContext {
  stage: HookStage;
  tenantId?: string;
  userId?: number;
  query?: string;
  documents?: unknown[];
  response?: string;
  error?: Error;
  metadata?: Record<string, unknown>;
}

export type HookFn = (ctx: HookContext) => Promise<HookContext> | HookContext;

interface RegisteredHook {
  fn: HookFn;
  priority: number;
}

// ─── Registry ─────────────────────────────────────────────────────────────────

export class HookRegistry {
  private readonly _hooks = new Map<HookStage, RegisteredHook[]>();

  /**
   * Register a hook function for a pipeline stage.
   * Hooks are sorted by priority (ascending) — lower number runs first.
   * Default priority is 100.
   */
  register(stage: HookStage, fn: HookFn, priority = 100): void {
    if (!this._hooks.has(stage)) {
      this._hooks.set(stage, []);
    }
    const list = this._hooks.get(stage)!;
    list.push({ fn, priority });
    // Keep sorted by priority so run() doesn't need to sort on every call
    list.sort((a, b) => a.priority - b.priority);
  }

  /**
   * Unregister a previously registered hook function.
   * Uses reference equality — the same function object must be passed.
   */
  unregister(stage: HookStage, fn: HookFn): void {
    const list = this._hooks.get(stage);
    if (!list) return;
    const idx = list.findIndex((h) => h.fn === fn);
    if (idx !== -1) list.splice(idx, 1);
  }

  /**
   * Run all hooks registered for the given stage in priority order.
   * Each hook receives the context returned by the previous hook.
   * If a hook throws, the error propagates immediately (remaining hooks are skipped).
   */
  async run(stage: HookStage, ctx: HookContext): Promise<HookContext> {
    const list = this._hooks.get(stage);
    if (!list || list.length === 0) return ctx;

    let current = ctx;
    for (const { fn } of list) {
      current = await fn(current);
    }
    return current;
  }

  /**
   * Clear all hooks for a given stage, or all stages if no stage is provided.
   */
  clear(stage?: HookStage): void {
    if (stage) {
      this._hooks.delete(stage);
    } else {
      this._hooks.clear();
    }
  }

  /**
   * List all registered hooks (for admin introspection).
   */
  list(): Array<{ stage: HookStage; count: number; priorities: number[] }> {
    const result: Array<{ stage: HookStage; count: number; priorities: number[] }> = [];
    for (const [stage, list] of this._hooks.entries()) {
      result.push({
        stage,
        count: list.length,
        priorities: list.map((h) => h.priority),
      });
    }
    return result;
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────────

/** Global hook registry — import this singleton to register or run hooks. */
export const hooks = new HookRegistry();
