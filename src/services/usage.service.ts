import { db } from "../lib/drizzle.js";
import { dailyUsage } from "../db/schema/users.js";
import { eq, and, gte, lte, sql, sum, count } from "drizzle-orm";
import logger from "../lib/logger.js";

export interface DailyUsage {
  userId: number;
  date: Date;
  tokens: number;
  requests: number;
}

export interface UsageUpdateInput {
  userId: number;
  tokensUsed: number;
  isCacheHit: boolean;
}

// Only bill tokens after successful completion.
// Request count is already incremented atomically in fastifyCheckQuota (P0-41).
// This function now ONLY updates token usage — never double-counts requests.
export async function updateDailyUsage(input: UsageUpdateInput): Promise<void> {
  const { userId, tokensUsed, isCacheHit } = input;

  // Validate tokensUsed is a non-negative finite number
  if (!Number.isFinite(tokensUsed) || tokensUsed < 0) {
    logger.warn({ userId, tokensUsed }, "Invalid tokensUsed value — skipping usage update");
    return;
  }

  if (!isCacheHit && tokensUsed > 0) {
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);

    try {
      await db.insert(dailyUsage).values({
        userId,
        date: today,
        tokens: tokensUsed,
        requests: 0,
        updatedAt: new Date(),
      }).onConflictDoUpdate({
        target: [dailyUsage.userId, dailyUsage.date],
        set: {
          tokens: sql`${dailyUsage.tokens} + ${tokensUsed}`,
          updatedAt: new Date(),
        },
      });
    } catch (err) {
      logger.error({ err, userId, tokensUsed }, "Failed to update daily tokens");
      throw err;
    }
  }
}

export async function getDailyUsage(
  userId: number,
  startDate?: Date,
  endDate?: Date
): Promise<DailyUsage[]> {
  try {
    const conditions = [eq(dailyUsage.userId, userId)];

    if (startDate) conditions.push(gte(dailyUsage.date, startDate));
    if (endDate) conditions.push(lte(dailyUsage.date, endDate));

    return await db.select({
      userId: dailyUsage.userId,
      date: dailyUsage.date,
      tokens: dailyUsage.tokens,
      requests: dailyUsage.requests,
    }).from(dailyUsage)
      .where(and(...conditions))
      .orderBy(sql`${dailyUsage.date} desc`);
  } catch (err) {
    logger.error({ err, userId, startDate, endDate }, "Failed to get daily usage");
    throw err;
  }
}

export async function getUsageStats(userId: number): Promise<{
  totalTokens: number;
  totalRequests: number;
  daysActive: number;
}> {
  try {
    const [result] = await db.select({
      totalTokens: sum(dailyUsage.tokens),
      totalRequests: sum(dailyUsage.requests),
      daysActive: count(dailyUsage.date),
    }).from(dailyUsage)
      .where(eq(dailyUsage.userId, userId));

    // Use Math.max(0, ...) to ensure non-negative values from DB aggregates
    return {
      totalTokens: Math.max(0, Number(result.totalTokens) || 0),
      totalRequests: Math.max(0, Number(result.totalRequests) || 0),
      daysActive: Math.max(0, Number(result.daysActive) || 0),
    };
  } catch (err) {
    logger.error({ err, userId }, "Failed to get usage stats");
    throw err;
  }
}
