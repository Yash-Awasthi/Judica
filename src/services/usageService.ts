import prisma from "../lib/db.js";
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
      await prisma.dailyUsage.upsert({
        where: { userId_date: { userId, date: today } },
        update: { tokens: { increment: tokensUsed } },
        create: { userId, date: today, tokens: tokensUsed, requests: 1 } as any
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
    const whereClause: any = { userId };
    
    if (startDate || endDate) {
      whereClause.date = {};
      if (startDate) whereClause.date.gte = startDate;
      if (endDate) whereClause.date.lte = endDate;
    }
    
    return await prisma.dailyUsage.findMany({
      where: whereClause,
      orderBy: { date: 'desc' }
    });
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
    const result = await prisma.dailyUsage.aggregate({
      where: { userId },
      _sum: { tokens: true, requests: true },
      _count: { date: true }
    });
    
    return {
      totalTokens: result._sum.tokens || 0,
      totalRequests: result._sum.requests || 0,
      daysActive: result._count.date || 0
    };
  } catch (err) {
    logger.error({ err, userId }, "Failed to get usage stats");
    throw err;
  }
}
