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

export async function updateDailyUsage(input: UsageUpdateInput): Promise<void> {
  const { userId, tokensUsed, isCacheHit } = input;

  if (!isCacheHit && tokensUsed > 0) {
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);

    try {
      await db.insert(dailyUsage).values({
        userId,
        date: today,
        tokens: tokensUsed,
        requests: 1,
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

    return {
      totalTokens: Number(result.totalTokens) || 0,
      totalRequests: Number(result.totalRequests) || 0,
      daysActive: Number(result.daysActive) || 0,
    };
  } catch (err) {
    logger.error({ err, userId }, "Failed to get usage stats");
    throw err;
  }
}
