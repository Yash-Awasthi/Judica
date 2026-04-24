/**
 * Connector Sync — Models
 *
 * Types for the auto-sync connector scheduler.
 * Modeled after Onyx's connector auto-refresh system.
 */

export interface ConnectorSyncConfig {
  /** Default sync interval in milliseconds (default: 30 min). */
  defaultIntervalMs: number;
  /** Maximum concurrent sync jobs. */
  maxConcurrent: number;
  /** Timeout per sync job in milliseconds. */
  jobTimeoutMs: number;
  /** Whether to retry failed syncs. */
  retryOnFailure: boolean;
  /** Max retry attempts. */
  maxRetries: number;
  /** Backoff multiplier for retries. */
  retryBackoffMs: number;
}

export const DEFAULT_SYNC_CONFIG: ConnectorSyncConfig = {
  defaultIntervalMs: 30 * 60 * 1000, // 30 minutes
  maxConcurrent: 5,
  jobTimeoutMs: 10 * 60 * 1000, // 10 minutes
  retryOnFailure: true,
  maxRetries: 3,
  retryBackoffMs: 60 * 1000, // 1 minute
};

export interface SyncSchedule {
  /** Connector ID. */
  connectorId: string;
  /** Connector type (e.g., "google_drive", "confluence", "slack"). */
  connectorType: string;
  /** Sync interval in milliseconds. */
  intervalMs: number;
  /** Whether this schedule is active. */
  enabled: boolean;
  /** Last successful sync timestamp. */
  lastSyncAt?: Date;
  /** Last sync status. */
  lastStatus?: "success" | "failed" | "running";
  /** Next scheduled sync timestamp. */
  nextSyncAt?: Date;
  /** Number of consecutive failures. */
  failureCount: number;
}

export type SyncMode = "incremental" | "full";

export interface SyncJob {
  id: string;
  connectorId: string;
  connectorType: string;
  mode: SyncMode;
  status: "pending" | "running" | "success" | "failed";
  startedAt?: Date;
  completedAt?: Date;
  documentsProcessed: number;
  documentsAdded: number;
  documentsUpdated: number;
  documentsDeleted: number;
  error?: string;
  retryCount: number;
}

export interface SyncResult {
  jobId: string;
  connectorId: string;
  success: boolean;
  documentsProcessed: number;
  documentsAdded: number;
  documentsUpdated: number;
  documentsDeleted: number;
  durationMs: number;
  error?: string;
}

export interface SyncEvent {
  type: "sync_started" | "sync_completed" | "sync_failed" | "sync_progress";
  connectorId: string;
  jobId: string;
  data?: Record<string, unknown>;
  timestamp: Date;
}
