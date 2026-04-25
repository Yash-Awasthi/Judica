/**
 * Specialized BullMQ Queues — one per worker type.
 * Separating I/O-bound (docfetch) from CPU-bound (docprocess)
 * prevents slow APIs from starving the embedding pipeline.
 */

import { Queue } from "bullmq";
import connection from "./connection.js";

const defaultJobOptions = {
  attempts: 3,
  backoff: { type: "exponential" as const, delay: 5000 },
  removeOnComplete: { count: 100 },
  removeOnFail: { count: 500 },
};

// ─── Specialized Queues ───────────────────────────────────────────────────────

/** Coordinator queue — singleton dispatcher, schedules connector syncs. */
export const coordinatorQueue = new Queue("coordinator", { connection, defaultJobOptions });

/** Light queue — fast metadata syncs, permission updates, ACL refreshes. */
export const lightQueue = new Queue("light", { connection, defaultJobOptions });

/** Heavy queue — long-running embedding, indexing, pruning, reranking. */
export const heavyQueue = new Queue("heavy", { connection, defaultJobOptions });

/** Doc-fetch queue — I/O-bound connector pulls from external APIs. */
export const docfetchQueue = new Queue("docfetch", { connection, defaultJobOptions });

/** Doc-process queue — CPU-bound chunking + embedding generation. */
export const docprocessQueue = new Queue("docprocess", { connection, defaultJobOptions });

/** User-file queue — processing user-uploaded files (PDF, DOCX, etc). */
export const userfileQueue = new Queue("userfile", { connection, defaultJobOptions });

/** Monitoring queue — metrics collection, health checks, stale job cleanup. */
export const monitoringQueue = new Queue("monitoring", { connection, defaultJobOptions });

// ─── Queue Registry ───────────────────────────────────────────────────────────

export const SPECIALIZED_QUEUES = {
  coordinator: coordinatorQueue,
  light: lightQueue,
  heavy: heavyQueue,
  docfetch: docfetchQueue,
  docprocess: docprocessQueue,
  userfile: userfileQueue,
  monitoring: monitoringQueue,
} as const;

export type SpecializedQueueName = keyof typeof SPECIALIZED_QUEUES;
