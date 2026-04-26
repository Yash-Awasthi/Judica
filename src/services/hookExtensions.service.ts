/**
 * Hook Extensions Service — CRUD, execution, and pipeline orchestration for
 * user-defined hook extensions (Phase 3.11).
 *
 * Hooks run in a lightweight sandboxed context (vm.runInNewContext) with a
 * configurable timeout. The execution pipeline runs all active hooks for a
 * given hook point in order, passing context through each one.
 */

import { db } from "../lib/drizzle.js";
import {
  hookExtensions,
  hookExecutionLogs,
  HOOK_POINTS,
  type HookPoint,
  type HookExtension,
  type HookExecutionLog,
} from "../db/schema/hookExtensions.js";
import { eq, and, asc, desc } from "drizzle-orm";
import vm from "node:vm";
import logger from "../lib/logger.js";
import { builtInHooks, type BuiltInHookTemplate } from "./builtInHooks.js";

const log = logger.child({ service: "hook-extensions" });

// ─── Types ──────────────────────────────────────────────────────────────────

export interface CreateHookInput {
  name: string;
  description?: string;
  hookPoint: HookPoint;
  executionOrder?: number;
  code: string;
  language?: "javascript" | "typescript";
  isActive?: boolean;
  config?: Record<string, unknown>;
  timeout?: number;
}

export interface UpdateHookInput {
  name?: string;
  description?: string;
  hookPoint?: HookPoint;
  executionOrder?: number;
  code?: string;
  language?: "javascript" | "typescript";
  isActive?: boolean;
  config?: Record<string, unknown>;
  timeout?: number;
}

export interface HookContext {
  content: string;
  config: Record<string, unknown>;
  conversationId?: string;
  hookPoint?: string;
  [key: string]: unknown;
}

export interface HookResult {
  content: string;
  metadata: Record<string, unknown>;
}

export interface PipelineResult {
  content: string;
  metadata: Record<string, unknown>;
  hooksExecuted: number;
  totalTimeMs: number;
  results: Array<{
    hookId: number;
    hookName: string;
    status: string;
    timeMs: number;
    error?: string;
  }>;
}

export interface PaginationOpts {
  limit?: number;
  offset?: number;
}

// ─── CRUD ───────────────────────────────────────────────────────────────────

export async function createHook(userId: number, input: CreateHookInput): Promise<HookExtension> {
  const [hook] = await db
    .insert(hookExtensions)
    .values({
      userId,
      name: input.name,
      description: input.description ?? null,
      hookPoint: input.hookPoint,
      executionOrder: input.executionOrder ?? 0,
      code: input.code,
      language: input.language ?? "javascript",
      isActive: input.isActive ?? true,
      config: input.config ?? null,
      timeout: input.timeout ?? 5000,
    })
    .returning();

  log.info({ hookId: hook.id, hookPoint: input.hookPoint }, "Hook extension created");
  return hook;
}

export async function getHooks(userId: number, hookPoint?: HookPoint): Promise<HookExtension[]> {
  const conditions = [eq(hookExtensions.userId, userId)];
  if (hookPoint) {
    conditions.push(eq(hookExtensions.hookPoint, hookPoint));
  }

  return db
    .select()
    .from(hookExtensions)
    .where(and(...conditions))
    .orderBy(asc(hookExtensions.hookPoint), asc(hookExtensions.executionOrder));
}

export async function getHookById(id: number): Promise<HookExtension | null> {
  const [hook] = await db
    .select()
    .from(hookExtensions)
    .where(eq(hookExtensions.id, id))
    .limit(1);

  return hook ?? null;
}

export async function updateHook(
  id: number,
  userId: number,
  input: UpdateHookInput,
): Promise<HookExtension | null> {
  const [updated] = await db
    .update(hookExtensions)
    .set({
      ...input,
      updatedAt: new Date(),
    })
    .where(and(eq(hookExtensions.id, id), eq(hookExtensions.userId, userId)))
    .returning();

  if (updated) {
    log.info({ hookId: id }, "Hook extension updated");
  }
  return updated ?? null;
}

export async function deleteHook(id: number, userId: number): Promise<boolean> {
  const [deleted] = await db
    .delete(hookExtensions)
    .where(and(eq(hookExtensions.id, id), eq(hookExtensions.userId, userId)))
    .returning();

  if (deleted) {
    log.info({ hookId: id }, "Hook extension deleted");
  }
  return !!deleted;
}

export async function toggleHook(
  id: number,
  userId: number,
  isActive: boolean,
): Promise<HookExtension | null> {
  const [updated] = await db
    .update(hookExtensions)
    .set({ isActive, updatedAt: new Date() })
    .where(and(eq(hookExtensions.id, id), eq(hookExtensions.userId, userId)))
    .returning();

  if (updated) {
    log.info({ hookId: id, isActive }, "Hook extension toggled");
  }
  return updated ?? null;
}

// ─── Execution ──────────────────────────────────────────────────────────────

/**
 * Execute a single hook in a sandboxed vm context.
 */
export async function executeHook(
  hookId: number,
  context: HookContext,
): Promise<HookResult> {
  const hook = await getHookById(hookId);
  if (!hook) {
    throw new Error(`Hook ${hookId} not found`);
  }

  return runHookCode(hook, context);
}

/**
 * Execute all active hooks for a given hook point in execution order.
 * Context is passed through each hook in sequence (pipeline pattern).
 */
export async function executeHookPipeline(
  hookPoint: HookPoint,
  context: HookContext,
): Promise<PipelineResult> {
  const hooks = await db
    .select()
    .from(hookExtensions)
    .where(and(eq(hookExtensions.hookPoint, hookPoint), eq(hookExtensions.isActive, true)))
    .orderBy(asc(hookExtensions.executionOrder));

  const pipelineStart = Date.now();
  let currentContent = context.content;
  const allMetadata: Record<string, unknown> = {};
  const results: PipelineResult["results"] = [];

  for (const hook of hooks) {
    const hookStart = Date.now();
    let status = "success";
    let errorMsg: string | undefined;
    let outputSize = 0;

    try {
      const hookContext: HookContext = {
        ...context,
        content: currentContent,
        config: { ...(hook.config as Record<string, unknown> ?? {}), ...context.config },
      };

      const result = await runHookCode(hook, hookContext);
      currentContent = result.content;
      outputSize = Buffer.byteLength(result.content, "utf8");

      // Merge metadata
      Object.assign(allMetadata, result.metadata);
    } catch (err) {
      const error = err as Error;
      if (error.message.includes("Script execution timed out")) {
        status = "timeout";
      } else {
        status = "error";
      }
      errorMsg = error.message;
      log.warn({ hookId: hook.id, error: errorMsg }, "Hook execution failed");
    }

    const timeMs = Date.now() - hookStart;

    results.push({
      hookId: hook.id,
      hookName: hook.name,
      status,
      timeMs,
      error: errorMsg,
    });

    // Log execution
    await db.insert(hookExecutionLogs).values({
      hookId: hook.id,
      conversationId: context.conversationId ?? null,
      executionTimeMs: timeMs,
      status: status as "success" | "error" | "timeout" | "skipped",
      inputSize: Buffer.byteLength(context.content, "utf8"),
      outputSize,
      errorMessage: errorMsg ?? null,
    });
  }

  return {
    content: currentContent,
    metadata: allMetadata,
    hooksExecuted: hooks.length,
    totalTimeMs: Date.now() - pipelineStart,
    results,
  };
}

// ─── Hook Code Runner ───────────────────────────────────────────────────────

function runHookCode(hook: HookExtension, context: HookContext): Promise<HookResult> {
  return new Promise((resolve, reject) => {
    try {
      // Build a minimal sandbox with no access to Node.js internals
      const sandbox: Record<string, unknown> = {
        console: {
          log: (...args: unknown[]) => log.debug({ hookId: hook.id }, String(args)),
          warn: (...args: unknown[]) => log.warn({ hookId: hook.id }, String(args)),
          error: (...args: unknown[]) => log.error({ hookId: hook.id }, String(args)),
        },
        Date,
        Math,
        JSON,
        RegExp,
        Array,
        Object,
        String,
        Number,
        Boolean,
        Error,
        Map,
        Set,
        parseInt,
        parseFloat,
        isNaN,
        isFinite,
        encodeURIComponent,
        decodeURIComponent,
      };

      const vmContext = vm.createContext(sandbox);

      // Wrap the code so `handler` is callable
      const wrappedCode = `
        ${hook.code}
        ;(__hookResult__ = handler(__hookContext__));
      `;

      // Inject context into sandbox
      sandbox.__hookContext__ = {
        content: context.content,
        config: context.config,
      };
      sandbox.__hookResult__ = undefined;

      const script = new vm.Script(wrappedCode, {
        filename: `hook-${hook.id}.js`,
        timeout: hook.timeout,
      });

      script.runInContext(vmContext);

      const result = sandbox.__hookResult__ as HookResult | undefined;
      if (!result || typeof result.content !== "string") {
        reject(new Error("Hook must return an object with a 'content' string property"));
        return;
      }

      resolve({
        content: result.content,
        metadata: result.metadata ?? {},
      });
    } catch (err) {
      reject(err);
    }
  });
}

// ─── Logs ───────────────────────────────────────────────────────────────────

export async function getHookLogs(
  hookId: number,
  opts: PaginationOpts = {},
): Promise<{ logs: HookExecutionLog[]; total: number }> {
  const limit = opts.limit ?? 50;
  const offset = opts.offset ?? 0;

  const logs = await db
    .select()
    .from(hookExecutionLogs)
    .where(eq(hookExecutionLogs.hookId, hookId))
    .orderBy(desc(hookExecutionLogs.createdAt))
    .limit(limit)
    .offset(offset);

  // Count total (simple approach — no separate count query for now)
  const allLogs = await db
    .select()
    .from(hookExecutionLogs)
    .where(eq(hookExecutionLogs.hookId, hookId));

  return { logs, total: allLogs.length };
}

// ─── Built-in Templates ─────────────────────────────────────────────────────

export function getBuiltInHooks(): BuiltInHookTemplate[] {
  return builtInHooks;
}

// ─── Validation ─────────────────────────────────────────────────────────────

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Validate hook code syntax. Attempts to compile the code without executing it.
 */
export function validateHookCode(code: string, language: string): ValidationResult {
  const errors: string[] = [];

  // Check for handler function
  if (!code.includes("function handler")) {
    errors.push("Code must define a 'handler' function: function handler(context) { ... }");
  }

  // Check for forbidden patterns (security)
  const forbidden = [
    { pattern: /require\s*\(/, msg: "require() is not allowed — hooks run in a sandboxed context" },
    { pattern: /import\s+/, msg: "import statements are not allowed — hooks run in a sandboxed context" },
    { pattern: /process\./, msg: "process access is not allowed in hooks" },
    { pattern: /global\./, msg: "global access is not allowed in hooks" },
    { pattern: /globalThis\./, msg: "globalThis access is not allowed in hooks" },
    { pattern: /eval\s*\(/, msg: "eval() is not allowed in hooks" },
    { pattern: /Function\s*\(/, msg: "Function constructor is not allowed in hooks" },
  ];

  for (const { pattern, msg } of forbidden) {
    if (pattern.test(code)) {
      errors.push(msg);
    }
  }

  // Try to compile (syntax check)
  try {
    new vm.Script(code, { filename: "validation.js" });
  } catch (err) {
    errors.push(`Syntax error: ${(err as Error).message}`);
  }

  return { valid: errors.length === 0, errors };
}

// ─── Reorder ────────────────────────────────────────────────────────────────

/**
 * Reorder hooks for a given hook point. orderedIds is the desired order of hook IDs.
 */
export async function reorderHooks(
  userId: number,
  hookPoint: HookPoint,
  orderedIds: number[],
): Promise<HookExtension[]> {
  // Update execution order based on position in orderedIds
  const updated: HookExtension[] = [];
  for (let i = 0; i < orderedIds.length; i++) {
    const [hook] = await db
      .update(hookExtensions)
      .set({ executionOrder: i, updatedAt: new Date() })
      .where(
        and(
          eq(hookExtensions.id, orderedIds[i]),
          eq(hookExtensions.userId, userId),
          eq(hookExtensions.hookPoint, hookPoint),
        ),
      )
      .returning();

    if (hook) {
      updated.push(hook);
    }
  }

  log.info({ userId, hookPoint, count: updated.length }, "Hooks reordered");
  return updated;
}
