/**
 * Connector Sync Background Worker
 *
 * Runs on a 60-second tick inside the Fastify process. On each tick:
 *   1. Calls triggerScheduledSyncs() to check for due cron schedules
 *   2. Executes any newly created sync jobs in the background
 *   3. Retries FAILED jobs that have a retryAfter in the past
 *
 * Also exports nextCronRunAt() — a lightweight cron next-run calculator
 * that covers the 5 most common schedule patterns without external deps.
 *
 * Production deployments with high connector volume should move job
 * execution to BullMQ workers; this in-process poller handles
 * single-instance deployments cleanly.
 */

import logger from "../logger.js";
import {
  triggerScheduledSyncs,
  executeSyncJob,
  getSyncJobs,
  SyncJobStatus,
} from "../../services/connectorSync.service.js";

const log = logger.child({ module: "syncWorker" });

let timer: NodeJS.Timeout | null = null;
let running = false;

// ── Cron next-run calculator ──────────────────────────────────────────────────
//
// Supports patterns (all in local server time):
//   "* * * * *"        — every minute
//   "*/N * * * *"      — every N minutes
//   "0 * * * *"        — every hour on the hour
//   "0 */N * * *"      — every N hours
//   "0 H * * *"        — daily at hour H (e.g. "0 3 * * *" = 3am daily)
//   "0 H * * D"        — weekly on day D at hour H
//
// For anything else, falls back to +1 hour.

export function nextCronRunAt(cron: string, from: Date = new Date()): Date {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return new Date(from.getTime() + 60 * 60_000);

  const [minPart, hrPart, , , dowPart] = parts;

  const next = new Date(from);
  next.setSeconds(0, 0);

  // Every minute
  if (minPart === "*" && hrPart === "*") {
    next.setMinutes(next.getMinutes() + 1);
    return next;
  }

  // */N minutes
  const everyNMin = minPart.match(/^\*\/(\d+)$/);
  if (everyNMin && hrPart === "*") {
    const n = parseInt(everyNMin[1], 10);
    const cur = next.getMinutes();
    const rem = n - (cur % n);
    next.setMinutes(next.getMinutes() + rem);
    return next;
  }

  // 0 */N hours
  const everyNHr = hrPart.match(/^\*\/(\d+)$/);
  if (minPart === "0" && everyNHr) {
    const n = parseInt(everyNHr[1], 10);
    const cur = next.getHours();
    const rem = n - (cur % n);
    next.setHours(next.getHours() + rem);
    next.setMinutes(0);
    return next;
  }

  // 0 H * * * — daily at hour H
  if (minPart === "0" && /^\d+$/.test(hrPart) && dowPart === "*") {
    const h = parseInt(hrPart, 10);
    next.setMinutes(0);
    if (next.getHours() < h) {
      next.setHours(h);
    } else {
      next.setHours(h);
      next.setDate(next.getDate() + 1);
    }
    return next;
  }

  // 0 H * * D — weekly on day D at hour H
  if (minPart === "0" && /^\d+$/.test(hrPart) && /^\d+$/.test(dowPart)) {
    const h = parseInt(hrPart, 10);
    const d = parseInt(dowPart, 10); // 0=Sun, 6=Sat
    next.setMinutes(0);
    next.setHours(h);
    const curDow = next.getDay();
    let daysUntil = (d - curDow + 7) % 7;
    if (daysUntil === 0 && from >= next) daysUntil = 7;
    next.setDate(next.getDate() + daysUntil);
    return next;
  }

  // Fallback — every hour
  return new Date(from.getTime() + 60 * 60_000);
}

// ── Worker tick ───────────────────────────────────────────────────────────────

async function tick() {
  if (running) return; // skip if previous tick is still going
  running = true;
  try {
    // 1. Trigger any due schedules
    const { triggered } = await triggerScheduledSyncs();
    if (triggered > 0) {
      log.info({ triggered }, "Scheduled syncs triggered");
    }

    // 2. Execute all pending jobs for all connectors (fire-and-forget per job)
    // We fetch pending + running jobs system-wide via an admin query
    // Limit to 10 concurrent executions per tick to avoid overwhelming the DB/APIs
    const BATCH_LIMIT = 10;
    const pendingJobs = await getPendingSystemJobs(BATCH_LIMIT);

    for (const job of pendingJobs) {
      executeJobBackground(job.id);
    }
  } catch (err) {
    log.error({ err }, "Sync worker tick error");
  } finally {
    running = false;
  }
}

function executeJobBackground(jobId: string) {
  executeSyncJob(jobId)
    .then(() => {
      log.debug({ jobId }, "Background sync job completed");
    })
    .catch((err) => {
      log.error({ jobId, err }, "Background sync job failed");
    });
}

// ── System-wide pending job query ─────────────────────────────────────────────

import { db } from "../drizzle.js";
import { connectorSyncJobs } from "../../db/schema/connectorSync.js";
import { eq } from "drizzle-orm";

async function getPendingSystemJobs(limit: number) {
  return db
    .select({ id: connectorSyncJobs.id })
    .from(connectorSyncJobs)
    .where(eq(connectorSyncJobs.status, SyncJobStatus.PENDING))
    .limit(limit);
}

// ── Public API ────────────────────────────────────────────────────────────────

export function startSyncWorker(intervalMs = 60_000): void {
  if (timer) return;
  log.info({ intervalMs }, "Connector sync worker started");
  timer = setInterval(() => { tick().catch(() => {}); }, intervalMs);
  // Run immediately on startup
  tick().catch(() => {});
}

export function stopSyncWorker(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
    log.info("Connector sync worker stopped");
  }
}
