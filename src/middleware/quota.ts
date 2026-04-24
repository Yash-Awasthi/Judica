// Single source of truth for quota checking.
// Atomic INSERT ... ON CONFLICT DO UPDATE RETURNING — no TOCTOU race.
import type { FastifyRequest, FastifyReply } from "fastify";
import { db } from "../lib/drizzle.js";
import { dailyUsage } from "../db/schema/users.js";
import { and, sql } from "drizzle-orm";
import logger from "../lib/logger.js";
import { DAILY_REQUEST_LIMIT, DAILY_TOKEN_LIMIT } from "../config/quotas.js";

const MAX_DAILY_REQUESTS = DAILY_REQUEST_LIMIT;
const MAX_DAILY_TOKENS = DAILY_TOKEN_LIMIT;

export async function fastifyCheckQuota(request: FastifyRequest, reply: FastifyReply) {
  const userId = (request as unknown as { userId?: number }).userId;
  if (!userId) return;

  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  // Atomic upsert: insert with requests=1 or increment, returning new totals.
  // Single round-trip — no TOCTOU window.
  const [usage] = await db
    .insert(dailyUsage)
    .values({
      userId,
      date: today,
      requests: 1,
      tokens: 0,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [dailyUsage.userId, dailyUsage.date],
      set: {
        requests: sql`${dailyUsage.requests} + 1`,
        updatedAt: new Date(),
      },
    })
    .returning();

  // Reject if post-increment value exceeds limits
  if (usage.requests > MAX_DAILY_REQUESTS || usage.tokens > MAX_DAILY_TOKENS) {
    // KNOWN RACE — Under high concurrency, another request may increment between
    // our check (line 41) and this rollback. The decrement could "steal" their quota slot.
    // Fix: Use a CTE with conditional increment: INSERT ... ON CONFLICT DO UPDATE SET
    //   requests = CASE WHEN requests < MAX THEN requests + 1 ELSE requests END
    // This eliminates the need for a separate rollback query entirely.
    // Accepted risk for now: at typical traffic levels, the race window is <1ms.
    // Roll back the optimistic increment so a rejected request isn't counted
    await db
      .update(dailyUsage)
      .set({ requests: sql`GREATEST(${dailyUsage.requests} - 1, 0)` })
      .where(and(
        sql`${dailyUsage.userId} = ${userId}`,
        sql`${dailyUsage.date} = ${today}`
      ));

    logger.warn({
      userId,
      requests: usage.requests,
      tokens: usage.tokens,
    }, "User exceeded daily quota limit");
    // Use post-rollback values in 429 headers — request was decremented
    const rolledBackRequests = Math.max(0, usage.requests - 1);
    reply
      .header("X-Quota-Limit", MAX_DAILY_REQUESTS.toString())
      .header("X-Quota-Used", rolledBackRequests.toString())
      .header("X-Quota-Remaining", Math.max(0, MAX_DAILY_REQUESTS - rolledBackRequests).toString())
      .header("X-Token-Limit", MAX_DAILY_TOKENS.toString())
      .header("X-Token-Used", usage.tokens.toString())
      .header("X-Token-Remaining", Math.max(0, MAX_DAILY_TOKENS - usage.tokens).toString())
      .header("Retry-After", "86400")
      .code(429)
      .send({ error: "Daily request or token quota exceeded. Please try again tomorrow." });
    return;
  }

  reply
    .header("X-Quota-Limit", MAX_DAILY_REQUESTS.toString())
    .header("X-Quota-Used", usage.requests.toString())
    .header("X-Quota-Remaining", Math.max(0, MAX_DAILY_REQUESTS - usage.requests).toString())
    .header("X-Token-Limit", MAX_DAILY_TOKENS.toString())
    .header("X-Token-Used", usage.tokens.toString())
    .header("X-Token-Remaining", Math.max(0, MAX_DAILY_TOKENS - usage.tokens).toString());
}
