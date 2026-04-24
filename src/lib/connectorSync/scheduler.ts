/**
 * Connector Sync — Scheduler
 *
 * BullMQ-based scheduler that triggers connector sync jobs periodically.
 * Supports incremental and full sync modes with retry logic.
 *
 * Modeled after Onyx's auto-sync connector system.
 */

import type {
  ConnectorSyncConfig,
  SyncSchedule,
  SyncJob,
  SyncResult,
  SyncMode,
} from "./models.js";
import { DEFAULT_SYNC_CONFIG } from "./models.js";
import logger from "../../lib/logger.js";
import { randomUUID } from "crypto";

type SyncHandler = (connectorId: string, connectorType: string, mode: SyncMode) => Promise<SyncResult>;

export class ConnectorSyncScheduler {
  private config: ConnectorSyncConfig;
  private schedules: Map<string, SyncSchedule> = new Map();
  private timers: Map<string, ReturnType<typeof setInterval>> = new Map();
  private activeJobs: Map<string, SyncJob> = new Map();
  private syncHandler: SyncHandler | null = null;

  constructor(config: Partial<ConnectorSyncConfig> = {}) {
    this.config = { ...DEFAULT_SYNC_CONFIG, ...config };
  }

  /** Set the handler that performs the actual sync. */
  setSyncHandler(handler: SyncHandler): void {
    this.syncHandler = handler;
  }

  /** Register a connector for periodic sync. */
  register(
    connectorId: string,
    connectorType: string,
    intervalMs?: number,
  ): void {
    const schedule: SyncSchedule = {
      connectorId,
      connectorType,
      intervalMs: intervalMs || this.config.defaultIntervalMs,
      enabled: true,
      failureCount: 0,
    };

    this.schedules.set(connectorId, schedule);

    // Schedule the repeating job
    const timer = setInterval(
      () => this.triggerSync(connectorId, "incremental"),
      schedule.intervalMs,
    );
    this.timers.set(connectorId, timer);

    logger.info(
      { connectorId, connectorType, intervalMs: schedule.intervalMs },
      "Registered connector for auto-sync",
    );
  }

  /** Unregister a connector from periodic sync. */
  unregister(connectorId: string): void {
    this.schedules.delete(connectorId);
    const timer = this.timers.get(connectorId);
    if (timer) {
      clearInterval(timer);
      this.timers.delete(connectorId);
    }
    logger.info({ connectorId }, "Unregistered connector from auto-sync");
  }

  /** Manually trigger a sync for a connector. */
  async triggerSync(connectorId: string, mode: SyncMode = "incremental"): Promise<SyncJob | null> {
    const schedule = this.schedules.get(connectorId);
    if (!schedule || !schedule.enabled) return null;

    // Check if already running
    const existing = this.activeJobs.get(connectorId);
    if (existing && existing.status === "running") {
      logger.debug({ connectorId }, "Sync already running, skipping");
      return existing;
    }

    // Check concurrent job limit
    const runningCount = [...this.activeJobs.values()].filter((j) => j.status === "running").length;
    if (runningCount >= this.config.maxConcurrent) {
      logger.warn({ connectorId, runningCount }, "Max concurrent syncs reached, skipping");
      return null;
    }

    const job: SyncJob = {
      id: randomUUID(),
      connectorId,
      connectorType: schedule.connectorType,
      mode,
      status: "running",
      startedAt: new Date(),
      documentsProcessed: 0,
      documentsAdded: 0,
      documentsUpdated: 0,
      documentsDeleted: 0,
      retryCount: 0,
    };

    this.activeJobs.set(connectorId, job);
    schedule.lastStatus = "running";

    try {
      if (!this.syncHandler) {
        throw new Error("No sync handler configured");
      }

      const result = await Promise.race([
        this.syncHandler(connectorId, schedule.connectorType, mode),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("Sync timeout")), this.config.jobTimeoutMs),
        ),
      ]);

      job.status = "success";
      job.completedAt = new Date();
      job.documentsProcessed = result.documentsProcessed;
      job.documentsAdded = result.documentsAdded;
      job.documentsUpdated = result.documentsUpdated;
      job.documentsDeleted = result.documentsDeleted;

      schedule.lastSyncAt = new Date();
      schedule.lastStatus = "success";
      schedule.failureCount = 0;
      schedule.nextSyncAt = new Date(Date.now() + schedule.intervalMs);

      logger.info({ connectorId, jobId: job.id, docs: result.documentsProcessed }, "Connector sync completed");
    } catch (err) {
      job.status = "failed";
      job.completedAt = new Date();
      job.error = err instanceof Error ? err.message : String(err);

      schedule.lastStatus = "failed";
      schedule.failureCount++;

      logger.error({ err, connectorId, jobId: job.id }, "Connector sync failed");

      // Retry logic
      if (this.config.retryOnFailure && job.retryCount < this.config.maxRetries) {
        const backoff = this.config.retryBackoffMs * (job.retryCount + 1);
        setTimeout(() => {
          job.retryCount++;
          this.triggerSync(connectorId, mode);
        }, backoff);
      }
    }

    return job;
  }

  /** Get all registered schedules. */
  getSchedules(): SyncSchedule[] {
    return [...this.schedules.values()];
  }

  /** Get schedule for a specific connector. */
  getSchedule(connectorId: string): SyncSchedule | null {
    return this.schedules.get(connectorId) || null;
  }

  /** Pause sync for a connector. */
  pause(connectorId: string): void {
    const schedule = this.schedules.get(connectorId);
    if (schedule) schedule.enabled = false;
    const timer = this.timers.get(connectorId);
    if (timer) {
      clearInterval(timer);
      this.timers.delete(connectorId);
    }
  }

  /** Resume sync for a connector. */
  resume(connectorId: string): void {
    const schedule = this.schedules.get(connectorId);
    if (!schedule) return;
    schedule.enabled = true;
    const timer = setInterval(
      () => this.triggerSync(connectorId, "incremental"),
      schedule.intervalMs,
    );
    this.timers.set(connectorId, timer);
  }

  /** Shut down all scheduled syncs. */
  shutdown(): void {
    for (const [id, timer] of this.timers) {
      clearInterval(timer);
      this.timers.delete(id);
    }
    logger.info("Connector sync scheduler shut down");
  }
}
