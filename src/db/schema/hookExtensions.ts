/**
 * Hook Extensions DB Schema — code injection points for compliance use cases.
 *
 * Phase 3.11: PII scrubbing before indexing, content filtering before delivery,
 * query transformation before the council sees it. Runs without forking the core
 * product. Admin-configurable. Ref: Onyx EE hook extensions.
 */

import {
  pgTable,
  serial,
  text,
  timestamp,
  integer,
  boolean,
  jsonb,
  index,
} from "drizzle-orm/pg-core";
import { users } from "./users.js";

// ─── Hook Point Enum ─────────────────────────────────────────────────────────

export const HOOK_POINTS = [
  "pre_indexing",
  "post_indexing",
  "pre_query",
  "post_query",
  "pre_response",
  "post_response",
  "pre_council",
  "post_council",
] as const;

export type HookPoint = (typeof HOOK_POINTS)[number];

// ─── Built-in Hook Types ─────────────────────────────────────────────────────

export const BUILT_IN_HOOK_TYPES = [
  "PII_SCRUBBER",
  "CONTENT_FILTER",
  "QUERY_TRANSFORMER",
  "AUDIT_LOGGER",
  "LENGTH_GUARD",
] as const;

export type BuiltInHookType = (typeof BUILT_IN_HOOK_TYPES)[number];

// ─── Hook Language ───────────────────────────────────────────────────────────

export const HOOK_LANGUAGES = ["javascript", "typescript"] as const;
export type HookLanguage = (typeof HOOK_LANGUAGES)[number];

// ─── Hook Execution Status ───────────────────────────────────────────────────

export const HOOK_EXECUTION_STATUSES = ["success", "error", "timeout", "skipped"] as const;
export type HookExecutionStatus = (typeof HOOK_EXECUTION_STATUSES)[number];

// ─── Hook Extensions Table ──────────────────────────────────────────────────

export const hookExtensions = pgTable(
  "HookExtension",
  {
    id: serial("id").primaryKey(),
    userId: integer("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** Human-readable name (e.g., "PII Scrubber for Support Tickets"). */
    name: text("name").notNull(),
    /** Description of what this hook does. */
    description: text("description"),
    /** Pipeline point where this hook runs. */
    hookPoint: text("hookPoint", { enum: HOOK_POINTS }).notNull(),
    /** Execution order within the hook point (lower = earlier). */
    executionOrder: integer("executionOrder").default(0).notNull(),
    /** The hook code (JS/TS). */
    code: text("code").notNull(),
    /** Language of the hook code. */
    language: text("language", { enum: HOOK_LANGUAGES }).default("javascript").notNull(),
    /** Whether the hook is currently active. */
    isActive: boolean("isActive").default(true).notNull(),
    /** Optional JSON config passed to the hook at runtime. */
    config: jsonb("config").$type<Record<string, unknown>>(),
    /** Max execution time in ms before the hook is killed. */
    timeout: integer("timeout").default(5000).notNull(),
    createdAt: timestamp("createdAt", { mode: "date", withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updatedAt", { mode: "date", withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("HookExtension_userId_idx").on(table.userId),
    index("HookExtension_hookPoint_idx").on(table.hookPoint),
    index("HookExtension_hookPoint_order_idx").on(table.hookPoint, table.executionOrder),
  ],
);

export type HookExtension = typeof hookExtensions.$inferSelect;
export type NewHookExtension = typeof hookExtensions.$inferInsert;

// ─── Hook Execution Logs Table ──────────────────────────────────────────────

export const hookExecutionLogs = pgTable(
  "HookExecutionLog",
  {
    id: serial("id").primaryKey(),
    hookId: integer("hookId")
      .notNull()
      .references(() => hookExtensions.id, { onDelete: "cascade" }),
    /** Conversation context (nullable — hooks may run outside conversations). */
    conversationId: text("conversationId"),
    /** How long the hook took to execute. */
    executionTimeMs: integer("executionTimeMs").notNull(),
    /** Outcome of the execution. */
    status: text("status", { enum: HOOK_EXECUTION_STATUSES }).notNull(),
    /** Size of the input payload in bytes. */
    inputSize: integer("inputSize").notNull(),
    /** Size of the output payload in bytes. */
    outputSize: integer("outputSize").notNull(),
    /** Error message if the hook failed. */
    errorMessage: text("errorMessage"),
    createdAt: timestamp("createdAt", { mode: "date", withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("HookExecutionLog_hookId_idx").on(table.hookId),
    index("HookExecutionLog_status_idx").on(table.status),
    index("HookExecutionLog_createdAt_idx").on(table.createdAt),
  ],
);

export type HookExecutionLog = typeof hookExecutionLogs.$inferSelect;
export type NewHookExecutionLog = typeof hookExecutionLogs.$inferInsert;
