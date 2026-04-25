/**
 * Document TTL Cleanup Worker — BullMQ repeatable job, every 1 hour.
 *
 * Deletes documents (uploads + memory chunks) where expiresAt IS NOT NULL
 * AND expiresAt < NOW(). Also cleans up orphaned vector embeddings in the
 * Memory table that no longer have a corresponding Upload or KBDocument.
 */

import { Worker, Queue } from "bullmq";
import connection from "../connection.js";
import { db } from "../../lib/drizzle.js";
import { sql } from "drizzle-orm";
import logger from "../../lib/logger.js";

export const cleanupQueue = new Queue("cleanup", {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: "exponential" as const, delay: 5000 },
    removeOnComplete: { count: 50 },
    removeOnFail: { count: 100 },
  },
});

export function startCleanupWorker(): Worker {
  const worker = new Worker(
    "cleanup",
    async (job) => {
      logger.info({ jobId: job.id }, "TTL cleanup job started");

      // 1. Delete expired uploads
      const uploadResult = await db.execute(sql`
        DELETE FROM "Upload"
        WHERE "expiresAt" IS NOT NULL AND "expiresAt" < NOW()
      `);
      const deletedUploads = uploadResult.rowCount ?? 0;

      // 2. Delete expired memory chunks (vector embeddings)
      const memoryResult = await db.execute(sql`
        DELETE FROM "Memory"
        WHERE "expiresAt" IS NOT NULL AND "expiresAt" < NOW()
      `);
      const deletedMemories = memoryResult.rowCount ?? 0;

      // 3. Delete orphaned Memory chunks whose KB has been deleted
      //    (foreign key cascade handles most cases, but handle any stragglers)
      const orphanResult = await db.execute(sql`
        DELETE FROM "Memory" m
        WHERE m."kbId" IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM "KnowledgeBase" kb WHERE kb.id = m."kbId"
          )
      `);
      const deletedOrphans = orphanResult.rowCount ?? 0;

      logger.info(
        { jobId: job.id, deletedUploads, deletedMemories, deletedOrphans },
        "TTL cleanup job completed"
      );

      return { deletedUploads, deletedMemories, deletedOrphans };
    },
    { connection, concurrency: 1 }
  );

  worker.on("failed", (job, err) => {
    logger.error({ jobId: job?.id, err }, "Cleanup worker job failed");
  });

  worker.on("completed", (job) => {
    logger.info({ jobId: job?.id }, "Cleanup worker job completed");
  });

  return worker;
}

/**
 * Register the repeatable cleanup job (every 1 hour).
 * Safe to call multiple times — BullMQ deduplicates by repeat key.
 */
export async function scheduleCleanupJob(): Promise<void> {
  await cleanupQueue.add(
    "ttl-cleanup",
    {},
    {
      repeat: { pattern: "0 * * * *" }, // every hour at :00
      jobId: "ttl-cleanup-repeatable",
    }
  );
  logger.info("TTL cleanup job scheduled (hourly)");
}
