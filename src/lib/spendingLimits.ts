/**
 * Spending Limit Enforcement — Phase 1.16
 *
 * Check and update user spending before and after LLM calls.
 * Inspired by Onyx EE and LiteLLM proxy budget enforcement.
 *
 * COST_PER_1K_TOKENS env var sets $/1K tokens (default 0.002 — ~GPT-3.5).
 */

import { db } from "./drizzle.js";
import { spendingLimits } from "../db/schema/spendingLimits.js";
import { eq, sql } from "drizzle-orm";

const COST_PER_1K = parseFloat(process.env.COST_PER_1K_TOKENS ?? "0.002");

export function estimateCostUsd(tokens: number): number {
  return (tokens / 1000) * COST_PER_1K;
}

/** Get next period reset date based on period type */
function nextResetDate(period: string): Date {
  const now = new Date();
  if (period === "daily") {
    const d = new Date(now);
    d.setUTCDate(d.getUTCDate() + 1);
    d.setUTCHours(0, 0, 0, 0);
    return d;
  }
  if (period === "weekly") {
    const d = new Date(now);
    d.setUTCDate(d.getUTCDate() + (7 - d.getUTCDay()));
    d.setUTCHours(0, 0, 0, 0);
    return d;
  }
  // monthly (default)
  const d = new Date(now);
  d.setUTCMonth(d.getUTCMonth() + 1, 1);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

/**
 * Check if user is under their spending cap.
 * Returns { allowed: true } or { allowed: false, reason, currentSpend, cap }.
 * Also resets period if expired.
 */
export async function checkSpendingLimit(userId: number): Promise<{
  allowed: boolean;
  reason?: string;
  currentSpendUsd?: number;
  capUsd?: number;
}> {
  const [limit] = await db
    .select()
    .from(spendingLimits)
    .where(eq(spendingLimits.userId, userId))
    .limit(1);

  if (!limit) return { allowed: true }; // No limit configured

  const now = new Date();

  // Reset if period expired
  if (now >= limit.periodResetsAt) {
    await db
      .update(spendingLimits)
      .set({
        currentSpendUsd: 0,
        periodResetsAt: nextResetDate(limit.period),
        updatedAt: now,
      })
      .where(eq(spendingLimits.userId, userId));
    return { allowed: true };
  }

  if (limit.currentSpendUsd >= limit.capUsd) {
    return {
      allowed: false,
      reason: `Spending cap of $${limit.capUsd.toFixed(2)} reached for this ${limit.period} period`,
      currentSpendUsd: limit.currentSpendUsd,
      capUsd: limit.capUsd,
    };
  }

  return { allowed: true, currentSpendUsd: limit.currentSpendUsd, capUsd: limit.capUsd };
}

/**
 * Record spend after a successful LLM call.
 * Increments currentSpendUsd by estimated cost.
 */
export async function recordSpend(userId: number, tokens: number): Promise<void> {
  const cost = estimateCostUsd(tokens);
  if (cost <= 0) return;

  await db
    .update(spendingLimits)
    .set({
      currentSpendUsd: sql`${spendingLimits.currentSpendUsd} + ${cost}`,
      updatedAt: new Date(),
    })
    .where(eq(spendingLimits.userId, userId));
}
