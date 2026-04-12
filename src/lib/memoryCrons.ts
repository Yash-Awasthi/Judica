import prisma from "../lib/db.js";
import { summarizeSession } from "../services/sessionSummary.service.js";
import { compact } from "../services/memoryCompaction.service.js";
import logger from "../lib/logger.js";

const ONE_HOUR = 60 * 60 * 1000;
const ONE_WEEK = 7 * 24 * 60 * 60 * 1000;

let summarizationTimer: ReturnType<typeof setInterval> | null = null;
let compactionTimer: ReturnType<typeof setInterval> | null = null;

async function runAutoSummarization(): Promise<void> {
  logger.info("Running auto-summarization job");

  try {
    const oneHourAgo = new Date(Date.now() - ONE_HOUR);

    const conversations = await prisma.conversation.findMany({
      where: {
        OR: [
          { sessionSummary: null },
          { updatedAt: { lt: oneHourAgo } },
        ],
      },
      select: { id: true, userId: true },
    });

    for (const convo of conversations) {
      const msgCount = await (prisma as any).message.count({
        where: { conversationId: convo.id },
      });

      if (msgCount > 30) {
        try {
          await summarizeSession(convo.id, convo.userId as number);
          logger.info({ conversationId: convo.id }, "Auto-summarized conversation");
        } catch (err) {
          logger.error({ err, conversationId: convo.id }, "Auto-summarization failed");
        }
      }
    }
  } catch (err) {
    logger.error({ err }, "Summarization job failed");
  }
}

async function runWeeklyCompaction(): Promise<void> {
  logger.info("Running weekly memory compaction job");

  try {
    const userCounts = await prisma.memory.groupBy({
      by: ["userId"],
      _count: { id: true },
      having: { id: { _count: { gt: 50 } } },
    });

    for (const entry of userCounts) {
      try {
        const result = await compact(entry.userId);
        logger.info(
          { userId: entry.userId, ...result },
          "Weekly compaction complete"
        );
      } catch (err) {
        logger.error({ err, userId: entry.userId }, "Weekly compaction failed");
      }
    }
  } catch (err) {
    logger.error({ err }, "Compaction job failed");
  }
}

export function startMemoryCrons(): void {
  // Run hourly summarization
  summarizationTimer = setInterval(runAutoSummarization, ONE_HOUR);

  // Run weekly compaction
  compactionTimer = setInterval(runWeeklyCompaction, ONE_WEEK);

  logger.info("Memory jobs started (hourly summarization, weekly compaction)");
}

export function stopMemoryCrons(): void {
  if (summarizationTimer) clearInterval(summarizationTimer);
  if (compactionTimer) clearInterval(compactionTimer);
  logger.info("Memory jobs stopped");
}
