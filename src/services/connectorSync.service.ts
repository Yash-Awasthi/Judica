/**
 * Connector Sync Service — orchestrates Load / Poll / Slim sync modes.
 *
 * Three sync modes keep the knowledge base current without thrashing:
 *   - Load: full bulk index (re-ingest everything)
 *   - Poll: incremental time-range updates since last sync
 *   - Slim: lightweight pruning check (removes deleted docs without re-indexing)
 */

import { randomUUID } from "node:crypto";
import { db } from "../lib/drizzle.js";
import {
  connectorSyncJobs,
  connectorSyncSchedules,
} from "../db/schema/connectorSync.js";
import {
  connectorInstances,
  connectorCredentials,
} from "../db/schema/connectors.js";
import { eq, and, lte, desc } from "drizzle-orm";
import {
  instantiateConnector,
  runConnector,
  isSlimConnector,
  DocumentSource,
  InputType,
} from "../connectors/index.js";
import logger from "../lib/logger.js";

const log = logger.child({ service: "connectorSync" });

// ─── Sync Mode Constants ─────────────────────────────────────────────────────

export const SyncMode = {
  LOAD: "load",
  POLL: "poll",
  SLIM: "slim",
} as const;

export type SyncMode = (typeof SyncMode)[keyof typeof SyncMode];

export const SyncJobStatus = {
  PENDING: "pending",
  RUNNING: "running",
  COMPLETED: "completed",
  FAILED: "failed",
} as const;

export type SyncJobStatus = (typeof SyncJobStatus)[keyof typeof SyncJobStatus];

// ─── Sync Job CRUD ───────────────────────────────────────────────────────────

export async function createSyncJob(
  connectorId: string,
  userId: number,
  syncMode: SyncMode,
) {
  const id = randomUUID();
  await db.insert(connectorSyncJobs).values({
    id,
    connectorId,
    userId,
    syncMode,
    status: SyncJobStatus.PENDING,
  });
  log.info({ jobId: id, connectorId, syncMode }, "Sync job created");
  return { id };
}

export async function getSyncJobById(id: string, userId: number) {
  const rows = await db
    .select()
    .from(connectorSyncJobs)
    .where(
      and(
        eq(connectorSyncJobs.id, id),
        eq(connectorSyncJobs.userId, userId),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

export interface GetSyncJobsOpts {
  limit?: number;
  offset?: number;
  status?: SyncJobStatus;
  syncMode?: SyncMode;
}

export async function getSyncJobs(
  connectorId: string,
  userId: number,
  opts: GetSyncJobsOpts = {},
) {
  const { limit = 20, offset = 0, status, syncMode } = opts;

  const conditions = [
    eq(connectorSyncJobs.connectorId, connectorId),
    eq(connectorSyncJobs.userId, userId),
  ];

  if (status) conditions.push(eq(connectorSyncJobs.status, status));
  if (syncMode) conditions.push(eq(connectorSyncJobs.syncMode, syncMode));

  return db
    .select()
    .from(connectorSyncJobs)
    .where(and(...conditions))
    .orderBy(desc(connectorSyncJobs.createdAt))
    .limit(limit)
    .offset(offset);
}

export async function cancelSyncJob(id: string, userId: number) {
  const job = await getSyncJobById(id, userId);
  if (!job) return null;

  if (job.status === SyncJobStatus.COMPLETED || job.status === SyncJobStatus.FAILED) {
    return { error: "Cannot cancel a job that has already finished" };
  }

  await db
    .update(connectorSyncJobs)
    .set({ status: SyncJobStatus.FAILED, errorMessage: "Cancelled by user", completedAt: new Date() })
    .where(eq(connectorSyncJobs.id, id));

  log.info({ jobId: id }, "Sync job cancelled");
  return { cancelled: true };
}

// ─── Sync Execution ──────────────────────────────────────────────────────────

export async function executeSyncJob(jobId: string) {
  const rows = await db
    .select()
    .from(connectorSyncJobs)
    .where(eq(connectorSyncJobs.id, jobId))
    .limit(1);

  const job = rows[0];
  if (!job) throw new Error(`Sync job ${jobId} not found`);

  // Mark as running
  const now = new Date();
  await db
    .update(connectorSyncJobs)
    .set({ status: SyncJobStatus.RUNNING, startedAt: now })
    .where(eq(connectorSyncJobs.id, jobId));

  // Fetch connector + credentials
  const connectorRows = await db
    .select()
    .from(connectorInstances)
    .where(eq(connectorInstances.id, job.connectorId))
    .limit(1);
  const connector = connectorRows[0];
  if (!connector) throw new Error(`Connector ${job.connectorId} not found`);

  const credRows = await db
    .select()
    .from(connectorCredentials)
    .where(eq(connectorCredentials.connectorId, job.connectorId))
    .limit(1);
  if (credRows.length === 0) {
    throw new Error(`No credentials found for connector ${job.connectorId}`);
  }

  try {
    const instance = await instantiateConnector({
      source: connector.source as DocumentSource,
      connectorId: job.connectorId,
      settings: connector.settings as Record<string, unknown>,
      credentials: credRows[0].credentialJson as Record<string, unknown>,
    });

    let documentsProcessed = 0;
    let documentsDeleted = 0;
    let errorMessage: string | undefined;
    let checkpoint: Record<string, unknown> | undefined;

    switch (job.syncMode) {
      case SyncMode.LOAD: {
        // Full load — pull everything
        const result = await runConnector(instance, InputType.LOAD_STATE, {
          checkpoint: (job.checkpoint as Record<string, unknown>) ?? null,
        });
        documentsProcessed = result.documents.length;
        if (result.failures.length > 0) {
          errorMessage = result.failures.map((f) => f.error).join("; ");
        }
        checkpoint = result.checkpoint as Record<string, unknown> | undefined;
        break;
      }

      case SyncMode.POLL: {
        // Incremental poll — fetch only changes since last sync
        const startEpochSecs = connector.lastSyncAt
          ? Math.floor(connector.lastSyncAt.getTime() / 1000)
          : 0;
        const endEpochSecs = Math.floor(Date.now() / 1000);

        const result = await runConnector(instance, InputType.POLL, {
          startEpochSecs,
          endEpochSecs,
        });
        documentsProcessed = result.documents.length;
        if (result.failures.length > 0) {
          errorMessage = result.failures.map((f) => f.error).join("; ");
        }
        break;
      }

      case SyncMode.SLIM: {
        // Slim pruning — check for deleted docs
        const pruneResult = await pruneDocuments(job.connectorId, job.userId);
        documentsDeleted = pruneResult.documentsDeleted;
        break;
      }
    }

    // Determine final status
    const finalStatus = errorMessage && documentsProcessed === 0
      ? SyncJobStatus.FAILED
      : SyncJobStatus.COMPLETED;

    // Update job record
    await db
      .update(connectorSyncJobs)
      .set({
        status: finalStatus,
        documentsProcessed,
        documentsDeleted,
        errorMessage,
        checkpoint: checkpoint ?? undefined,
        completedAt: new Date(),
      })
      .where(eq(connectorSyncJobs.id, jobId));

    // Update connector last sync time
    const syncNow = new Date();
    await db
      .update(connectorInstances)
      .set({ lastSyncAt: syncNow, updatedAt: syncNow })
      .where(eq(connectorInstances.id, job.connectorId));

    log.info(
      { jobId, connectorId: job.connectorId, syncMode: job.syncMode, documentsProcessed, documentsDeleted },
      "Sync job complete",
    );

    return { jobId, status: finalStatus, documentsProcessed, documentsDeleted, errorMessage };
  } catch (err) {
    await db
      .update(connectorSyncJobs)
      .set({
        status: SyncJobStatus.FAILED,
        errorMessage: (err as Error).message,
        completedAt: new Date(),
      })
      .where(eq(connectorSyncJobs.id, jobId));

    log.error({ jobId, err }, "Sync job failed");
    throw err;
  }
}

// ─── Slim Mode: Prune Documents ──────────────────────────────────────────────

export async function pruneDocuments(
  connectorId: string,
  userId: number,
): Promise<{ documentsDeleted: number }> {
  const connectorRows = await db
    .select()
    .from(connectorInstances)
    .where(eq(connectorInstances.id, connectorId))
    .limit(1);
  const connector = connectorRows[0];
  if (!connector) throw new Error(`Connector ${connectorId} not found`);

  const credRows = await db
    .select()
    .from(connectorCredentials)
    .where(eq(connectorCredentials.connectorId, connectorId))
    .limit(1);

  if (credRows.length === 0) {
    throw new Error(`No credentials found for connector ${connectorId}`);
  }

  const instance = await instantiateConnector({
    source: connector.source as DocumentSource,
    connectorId,
    settings: connector.settings as Record<string, unknown>,
    credentials: credRows[0].credentialJson as Record<string, unknown>,
  });

  if (!isSlimConnector(instance)) {
    log.warn({ connectorId }, "Connector does not support slim retrieval, skipping prune");
    return { documentsDeleted: 0 };
  }

  // Collect all current document IDs from source
  const currentDocIds = new Set<string>();
  for await (const batch of instance.retrieveAllSlimDocs()) {
    for (const doc of batch) {
      currentDocIds.add(doc.id);
    }
  }

  // TODO: Compare against indexed documents and remove stale ones.
  // This requires integration with the vector store / document index.
  // For now, return the count of live docs found for telemetry.
  log.info(
    { connectorId, liveDocCount: currentDocIds.size },
    "Slim prune: retrieved current doc IDs from source",
  );

  return { documentsDeleted: 0 };
}

// ─── Poll Mode Helper ────────────────────────────────────────────────────────

export async function pollDocuments(
  connectorId: string,
  userId: number,
  since: Date,
) {
  const connectorRows = await db
    .select()
    .from(connectorInstances)
    .where(eq(connectorInstances.id, connectorId))
    .limit(1);
  const connector = connectorRows[0];
  if (!connector) throw new Error(`Connector ${connectorId} not found`);

  const credRows = await db
    .select()
    .from(connectorCredentials)
    .where(eq(connectorCredentials.connectorId, connectorId))
    .limit(1);
  if (credRows.length === 0) {
    throw new Error(`No credentials found for connector ${connectorId}`);
  }

  const instance = await instantiateConnector({
    source: connector.source as DocumentSource,
    connectorId,
    settings: connector.settings as Record<string, unknown>,
    credentials: credRows[0].credentialJson as Record<string, unknown>,
  });

  const startEpochSecs = Math.floor(since.getTime() / 1000);
  const endEpochSecs = Math.floor(Date.now() / 1000);

  return runConnector(instance, InputType.POLL, {
    startEpochSecs,
    endEpochSecs,
  });
}

// ─── Schedule CRUD ───────────────────────────────────────────────────────────

export interface CreateSyncScheduleInput {
  connectorId: string;
  userId: number;
  syncMode: SyncMode;
  cronExpression: string;
  enabled?: boolean;
}

export async function createSyncSchedule(input: CreateSyncScheduleInput) {
  const id = randomUUID();
  const now = new Date();
  await db.insert(connectorSyncSchedules).values({
    id,
    connectorId: input.connectorId,
    userId: input.userId,
    syncMode: input.syncMode,
    cronExpression: input.cronExpression,
    enabled: input.enabled ?? true,
    nextRunAt: now, // Will be computed properly by triggerScheduledSyncs
  });
  log.info({ scheduleId: id, connectorId: input.connectorId, syncMode: input.syncMode }, "Sync schedule created");
  return { id };
}

export async function getSyncSchedules(connectorId: string, userId: number) {
  return db
    .select()
    .from(connectorSyncSchedules)
    .where(
      and(
        eq(connectorSyncSchedules.connectorId, connectorId),
        eq(connectorSyncSchedules.userId, userId),
      ),
    )
    .orderBy(desc(connectorSyncSchedules.createdAt));
}

export interface UpdateSyncScheduleInput {
  cronExpression?: string;
  syncMode?: SyncMode;
  enabled?: boolean;
}

export async function updateSyncSchedule(
  id: string,
  userId: number,
  input: UpdateSyncScheduleInput,
) {
  const rows = await db
    .select()
    .from(connectorSyncSchedules)
    .where(
      and(
        eq(connectorSyncSchedules.id, id),
        eq(connectorSyncSchedules.userId, userId),
      ),
    )
    .limit(1);

  if (rows.length === 0) return null;

  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (input.cronExpression !== undefined) updates.cronExpression = input.cronExpression;
  if (input.syncMode !== undefined) updates.syncMode = input.syncMode;
  if (input.enabled !== undefined) updates.enabled = input.enabled;

  await db
    .update(connectorSyncSchedules)
    .set(updates)
    .where(eq(connectorSyncSchedules.id, id));

  log.info({ scheduleId: id }, "Sync schedule updated");
  return { updated: true };
}

export async function deleteSyncSchedule(id: string, userId: number) {
  const rows = await db
    .select()
    .from(connectorSyncSchedules)
    .where(
      and(
        eq(connectorSyncSchedules.id, id),
        eq(connectorSyncSchedules.userId, userId),
      ),
    )
    .limit(1);

  if (rows.length === 0) return null;

  await db.delete(connectorSyncSchedules).where(eq(connectorSyncSchedules.id, id));
  log.info({ scheduleId: id }, "Sync schedule deleted");
  return { deleted: true };
}

// ─── Scheduled Sync Trigger ──────────────────────────────────────────────────

/**
 * Check all enabled schedules for due syncs and create jobs.
 * Called by the BullMQ worker on a cron tick.
 */
export async function triggerScheduledSyncs(): Promise<{ triggered: number }> {
  const now = new Date();

  const dueSchedules = await db
    .select()
    .from(connectorSyncSchedules)
    .where(
      and(
        eq(connectorSyncSchedules.enabled, true),
        lte(connectorSyncSchedules.nextRunAt, now),
      ),
    );

  let triggered = 0;

  for (const schedule of dueSchedules) {
    try {
      const { id: jobId } = await createSyncJob(
        schedule.connectorId,
        schedule.userId,
        schedule.syncMode as SyncMode,
      );

      // Update schedule timestamps
      // Simple next-run calculation: advance by the smallest cron interval
      // A full cron parser would be used in production; for now advance 1 hour
      const nextRun = new Date(now.getTime() + 60 * 60_000);
      await db
        .update(connectorSyncSchedules)
        .set({
          lastRunAt: now,
          nextRunAt: nextRun,
          updatedAt: now,
        })
        .where(eq(connectorSyncSchedules.id, schedule.id));

      log.info(
        { scheduleId: schedule.id, jobId, syncMode: schedule.syncMode },
        "Scheduled sync triggered",
      );
      triggered++;
    } catch (err) {
      log.error({ scheduleId: schedule.id, err }, "Failed to trigger scheduled sync");
    }
  }

  return { triggered };
}
