/**
 * LLM Spending Limits — Phase 1.16
 *
 * Per-user dollar-based spending caps enforced at request time.
 *
 * Inspired by:
 * - Onyx EE (Apache 2.0, onyx-dot-app/onyx) — enterprise LLM cost controls
 * - LiteLLM proxy (MIT, BerriAI/litellm) — budget-based routing and enforcement
 *
 * Each user has an optional SpendingLimit row. When a request arrives,
 * the current period spend is checked against the cap. If exceeded, the
 * request is rejected with 402 Payment Required.
 *
 * Cost model: simple token-based estimate (no live pricing API).
 * Default: $0.002 per 1K tokens (rough GPT-3.5 equivalent).
 * Override via COST_PER_1K_TOKENS env var.
 */

import { pgTable, uuid, integer, real, text, timestamp } from "drizzle-orm/pg-core";
import { users } from "./users.js";

export const spendingLimits = pgTable("spending_limits", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: integer("user_id").notNull().unique().references(() => users.id, { onDelete: "cascade" }),
  /** Hard cap in USD for the current period */
  capUsd: real("cap_usd").notNull(),
  /** Reset period: daily | weekly | monthly */
  period: text("period").notNull().default("monthly"),
  /** Accumulated spend in USD for the current period */
  currentSpendUsd: real("current_spend_usd").notNull().default(0),
  /** When the current period resets */
  periodResetsAt: timestamp("period_resets_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type SpendingLimit = typeof spendingLimits.$inferSelect;
export type NewSpendingLimit = typeof spendingLimits.$inferInsert;
