/**
 * Worker Base Config — shared configuration for all specialized workers.
 * Modeled after Onyx's per-worker Celery configs with a shared base.
 */

import type { WorkerOptions } from "bullmq";
import connection from "../connection.js";

/** Common worker options shared across all worker types. */
export const BASE_WORKER_OPTIONS: WorkerOptions = {
  connection,
  autorun: false,
  removeOnComplete: { count: 100 },
  removeOnFail: { count: 500 },
};

/**
 * Worker type definitions with their concurrency and purpose.
 *
 * Type         | Concurrency | Purpose
 * -------------|-------------|------------------------------------------
 * coordinator  | 1           | Singleton dispatcher, schedules other jobs
 * light        | 20          | Fast metadata syncs, permission updates
 * heavy        | 2           | Long-running embedding, indexing, pruning
 * docfetch     | 8           | I/O-bound connector pulls (external APIs)
 * docprocess   | 4           | CPU-bound chunking + embedding
 * userfile     | 3           | User-uploaded file processing
 * monitoring   | 1           | Metrics collection, health checks
 */
export const WORKER_CONFIGS = {
  coordinator: {
    concurrency: 1,
    lockDuration: 30_000,
    prefetchMultiplier: 1,
  },
  light: {
    concurrency: 20,
    lockDuration: 10_000,
    prefetchMultiplier: 4,
  },
  heavy: {
    concurrency: 2,
    lockDuration: 300_000, // 5 min — heavy tasks may be slow
    prefetchMultiplier: 1,
  },
  docfetch: {
    concurrency: 8,
    lockDuration: 120_000, // 2 min — API calls can be slow
    prefetchMultiplier: 2,
  },
  docprocess: {
    concurrency: 4,
    lockDuration: 180_000, // 3 min — embedding can be slow
    prefetchMultiplier: 1,
  },
  userfile: {
    concurrency: 3,
    lockDuration: 120_000,
    prefetchMultiplier: 1,
  },
  monitoring: {
    concurrency: 1,
    lockDuration: 10_000,
    prefetchMultiplier: 1,
  },
} as const;

export type WorkerType = keyof typeof WORKER_CONFIGS;
