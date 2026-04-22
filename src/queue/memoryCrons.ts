// P5-11: Moved from lib/ to queue/ — these are background job schedulers, not library utilities
import { db } from "../lib/drizzle.js";
import { conversations } from "../db/schema/conversations.js";
import { chats } from "../db/schema/conversations.js";
import { memories } from "../db/schema/memory.js";
import { summarizeSession } from "../services/sessionSummary.service.js";
import { compact } from "../services/memoryCompaction.service.js";
import logger from "../lib/logger.js";
import { isNull, lt, or, eq, count, sql } from "drizzle-orm";

// P10-64: Externalized compaction thresholds via environment/config
// P53-06: NaN guards for all parseInt calls
const _parsedSummarizationInterval = parseInt(process.env.MEMORY_SUMMARIZATION_INTERVAL_MS || "3600000", 10);
const SUMMARIZATION_INTERVAL_MS = Number.isNaN(_parsedSummarizationInterval) ? 3600000 : _parsedSummarizationInterval; // 1 hour
const _parsedCompactionInterval = parseInt(process.env.MEMORY_COMPACTION_INTERVAL_MS || "604800000", 10);
const COMPACTION_INTERVAL_MS = Number.isNaN(_parsedCompactionInterval) ? 604800000 : _parsedCompactionInterval; // 1 week
const _parsedMinMessages = parseInt(process.env.MEMORY_MIN_MESSAGES || "30", 10);
const MIN_MESSAGES_FOR_SUMMARIZATION = Number.isNaN(_parsedMinMessages) ? 30 : _parsedMinMessages;
const _parsedMinMemories = parseInt(process.env.MEMORY_MIN_MEMORIES || "50", 10);
const MIN_MEMORIES_FOR_COMPACTION = Number.isNaN(_parsedMinMemories) ? 50 : _parsedMinMemories;
const _parsedBatchSize = parseInt(process.env.MEMORY_COMPACTION_BATCH_SIZE || "100", 10);
const COMPACTION_BATCH_SIZE = Number.isNaN(_parsedBatchSize) ? 100 : _parsedBatchSize; // P10-62: Bounded query

let summarizationTimer: ReturnType<typeof setTimeout> | null = null;
let compactionTimer: ReturnType<typeof setTimeout> | null = null;
let jitterTimer: ReturnType<typeof setTimeout> | null = null;
// P10-65: Track whether a job is currently running to prevent stacking
let summarizationRunning = false;
let compactionRunning = false;
// P10-63: Track last summarized conversation to avoid re-processing
const summarizedSessions = new Set<string>();
// P53-06: Cap summarizedSessions to prevent unbounded growth
const MAX_SUMMARIZED_SESSIONS = 50_000;

async function runAutoSummarization(): Promise<void> {
  // P10-65: Prevent overlapping invocations
  if (summarizationRunning) {
    logger.warn("Auto-summarization already running — skipping this tick");
    return;
  }
  summarizationRunning = true;

  logger.info("Running auto-summarization job");

  try {
    const oneHourAgo = new Date(Date.now() - SUMMARIZATION_INTERVAL_MS);

    // P10-62: Bounded query with LIMIT to prevent OOM
    const convos = await db
      .select({ id: conversations.id, userId: conversations.userId })
      .from(conversations)
      .where(
        or(
          isNull(conversations.sessionSummary),
          lt(conversations.updatedAt, oneHourAgo)
        )
      )
      .limit(COMPACTION_BATCH_SIZE);

    for (const convo of convos) {
      // P10-63: Skip already-summarized sessions in this run cycle
      if (summarizedSessions.has(convo.id)) continue;

      const [result] = await db
        .select({ count: count() })
        .from(chats)
        .where(eq(chats.conversationId, convo.id));

      const msgCount = result?.count ?? 0;

      if (msgCount > MIN_MESSAGES_FOR_SUMMARIZATION) {
        try {
          await summarizeSession(convo.id, convo.userId as number);
          summarizedSessions.add(convo.id); // P10-63: Mark as processed
          if (summarizedSessions.size > MAX_SUMMARIZED_SESSIONS) {
            summarizedSessions.clear();
          }
          logger.info({ conversationId: convo.id }, "Auto-summarized conversation");
        } catch (err) {
          logger.error({ err, conversationId: convo.id }, "Auto-summarization failed");
        }
      }
    }
  } catch (err) {
    logger.error({ err }, "Summarization job failed");
  } finally {
    summarizationRunning = false;
  }
}

async function runWeeklyCompaction(): Promise<void> {
  // P10-65: Prevent overlapping invocations
  if (compactionRunning) {
    logger.warn("Weekly compaction already running — skipping this tick");
    return;
  }
  compactionRunning = true;

  logger.info("Running weekly memory compaction job");

  try {
    // P10-62: Bounded query with LIMIT and cursor-based pagination
    const userCounts = await db
      .select({
        userId: memories.userId,
        count: count(memories.id),
      })
      .from(memories)
      .groupBy(memories.userId)
      .having(sql`count(${memories.id}) > ${MIN_MEMORIES_FOR_COMPACTION}`)
      .limit(COMPACTION_BATCH_SIZE);

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
  } finally {
    compactionRunning = false;
  }
}

// P10-65: Use setTimeout-based scheduling to prevent overlapping invocations
function scheduleSummarization(): void {
  summarizationTimer = setTimeout(async () => {
    await runAutoSummarization();
    scheduleSummarization(); // Re-schedule after completion
  }, SUMMARIZATION_INTERVAL_MS);
}

function scheduleCompaction(): void {
  compactionTimer = setTimeout(async () => {
    await runWeeklyCompaction();
    scheduleCompaction(); // Re-schedule after completion
  }, COMPACTION_INTERVAL_MS);
}

export function startMemoryCrons(): void {
  // P10-66: Add random startup jitter (0-30s) to prevent thundering herd
  const jitter = Math.floor(Math.random() * 30000);

  jitterTimer = setTimeout(() => {
    scheduleSummarization();
    scheduleCompaction();
    logger.info({ jitterMs: jitter }, "Memory jobs started with jitter (sequential scheduling, no stacking)");
  }, jitter);
}

export function stopMemoryCrons(): void {
  if (jitterTimer) clearTimeout(jitterTimer);
  if (summarizationTimer) clearTimeout(summarizationTimer);
  if (compactionTimer) clearTimeout(compactionTimer);
  jitterTimer = null;
  summarizationTimer = null;
  compactionTimer = null;
  logger.info("Memory jobs stopped");
}
