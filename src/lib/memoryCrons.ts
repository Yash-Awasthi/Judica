import { db } from "./drizzle.js";
import { conversations } from "../db/schema/conversations.js";
import { chats } from "../db/schema/conversations.js";
import { memories } from "../db/schema/memory.js";
import { summarizeSession } from "../services/sessionSummary.service.js";
import { compact } from "../services/memoryCompaction.service.js";
import logger from "./logger.js";
import { isNull, lt, or, eq, count, sql } from "drizzle-orm";

const ONE_HOUR = 60 * 60 * 1000;
const ONE_WEEK = 7 * 24 * 60 * 60 * 1000;

let summarizationTimer: ReturnType<typeof setInterval> | null = null;
let compactionTimer: ReturnType<typeof setInterval> | null = null;

async function runAutoSummarization(): Promise<void> {
  logger.info("Running auto-summarization job");

  try {
    const oneHourAgo = new Date(Date.now() - ONE_HOUR);

    const convos = await db
      .select({ id: conversations.id, userId: conversations.userId })
      .from(conversations)
      .where(
        or(
          isNull(conversations.sessionSummary),
          lt(conversations.updatedAt, oneHourAgo)
        )
      );

    for (const convo of convos) {
      const [result] = await db
        .select({ count: count() })
        .from(chats)
        .where(eq(chats.conversationId, convo.id));

      const msgCount = result?.count ?? 0;

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
    const userCounts = await db
      .select({
        userId: memories.userId,
        count: count(memories.id),
      })
      .from(memories)
      .groupBy(memories.userId)
      .having(sql`count(${memories.id}) > 50`);

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
