/**
 * Memory Decay & Reinforcement — Phase 2.6
 *
 * Implements Ebbinghaus forgetting curve for memory facts.
 * Facts decay over time; confirmed facts get reinforcement.
 *
 * Inspired by:
 * - Ebbinghaus Forgetting Curve — retention = e^(-t/stability)
 * - Anki (AGPL, ankitects/anki) — spaced repetition algorithm
 * - mem0 (Apache 2.0, mem0ai/mem0) — memory recency weighting
 *
 * Decay formula: newScore = score × e^(-daysSinceConfirm / halfLife)
 * Half-life defaults:
 *   - global scope: 90 days
 *   - session scope: 7 days
 *   - conversation scope: 1 day
 */

import { db } from "./drizzle.js";
import { memoryFacts } from "../db/schema/memoryFacts.js";
import { lt, sql, eq } from "drizzle-orm";
import logger from "./logger.js";

const HALF_LIFE_DAYS = {
  global: 90,
  session: 7,
  conversation: 1,
};

/**
 * Apply Ebbinghaus decay to a single memory score.
 * @param currentScore - Current decay score (0–1)
 * @param daysSinceLastConfirm - Days elapsed since last confirmation
 * @param halfLifeDays - Half-life in days
 */
export function applyDecay(
  currentScore: number,
  daysSinceLastConfirm: number,
  halfLifeDays = HALF_LIFE_DAYS.global,
): number {
  return currentScore * Math.exp(-daysSinceLastConfirm * Math.log(2) / halfLifeDays);
}

/**
 * Run the decay sweep across all memory facts.
 * Should be called periodically (e.g., daily cron job).
 * Updates decayScore for all facts based on days since lastConfirmedAt.
 */
export async function runDecaySweep(): Promise<number> {
  const now = new Date();

  // Fetch facts that need decay update (not confirmed in the last day)
  const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  const factsToDecay = await db
    .select({ id: memoryFacts.id, decayScore: memoryFacts.decayScore, lastConfirmedAt: memoryFacts.lastConfirmedAt })
    .from(memoryFacts)
    .where(lt(memoryFacts.lastConfirmedAt, oneDayAgo))
    .limit(10000);

  let updated = 0;

  for (const fact of factsToDecay) {
    const lastConfirmed = fact.lastConfirmedAt ?? new Date(0);
    const daysSince = (now.getTime() - lastConfirmed.getTime()) / (1000 * 60 * 60 * 24);
    const newScore = applyDecay(fact.decayScore ?? 1.0, daysSince);

    if (Math.abs(newScore - (fact.decayScore ?? 1.0)) > 0.001) {
      await db
        .update(memoryFacts)
        .set({ decayScore: Math.max(0, newScore) })
        .where(eq(memoryFacts.id, fact.id));
      updated++;
    }
  }

  logger.info({ updated }, "Memory decay sweep completed");
  return updated;
}

/**
 * Reinforce a memory fact (mark as recently confirmed).
 * Resets decay score to max(current, reinforcementBoost).
 */
export async function reinforceMemory(
  factId: string,
  reinforcementBoost = 1.0,
): Promise<void> {
  await db
    .update(memoryFacts)
    .set({
      decayScore: sql`GREATEST(${memoryFacts.decayScore}, ${reinforcementBoost})`,
      lastConfirmedAt: new Date(),
    })
    .where(eq(memoryFacts.id, factId));
}
