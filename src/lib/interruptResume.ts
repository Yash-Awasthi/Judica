/**
 * Interrupt-Modify-Resume — Phase 7.18
 *
 * Allows a running deliberation to be paused, its context modified,
 * and then resumed from the point of interruption.
 *
 * Inspired by:
 * - LangGraph interrupt() — mid-run state editing
 * - OpenAI Assistants API run cancellation + replay pattern
 *
 * State machine:
 *   running → interrupted → (modified?) → resumed | cancelled
 *
 * Storage: Redis with 24h TTL (deliberations are time-bounded)
 */

import redis from "./redis.js";
import logger from "./logger.js";

const RUN_TTL_SECONDS = 60 * 60 * 24; // 24 hours
const MAX_RUNS_PER_USER = 100;

export type RunStatus = "running" | "interrupted" | "resumed" | "cancelled" | "completed";

export interface DeliberationRun {
  id:              string;
  userId:          number;
  status:          RunStatus;
  question:        string;
  /** Messages exchanged so far (partial) */
  partialMessages: Array<{ role: string; content: string }>;
  /** Any user modifications applied during interrupt */
  modifications:   string[];
  createdAt:       number;
  interruptedAt:   number | null;
  resumedAt:       number | null;
}

function redisKey(userId: number, runId: string) {
  return `imr:${userId}:${runId}`;
}

function userRunsKey(userId: number) {
  return `imr-runs:${userId}`;
}

async function loadRun(userId: number, runId: string): Promise<DeliberationRun | null> {
  try {
    const raw = await redis.get(redisKey(userId, runId));
    return raw ? (JSON.parse(raw) as DeliberationRun) : null;
  } catch {
    return null;
  }
}

async function saveRun(run: DeliberationRun): Promise<void> {
  try {
    await redis.set(
      redisKey(run.userId, run.id),
      JSON.stringify(run),
      "EX", RUN_TTL_SECONDS,
    );
    // Track run IDs per user (as a sorted set by creation time)
    await redis.zadd(userRunsKey(run.userId), run.createdAt, run.id);
    // Trim to max runs per user
    await redis.zremrangebyrank(userRunsKey(run.userId), 0, -(MAX_RUNS_PER_USER + 1));
  } catch (err) {
    logger.warn({ err }, "IMR: failed to save run state");
  }
}

/**
 * Create a new deliberation run record.
 */
export async function createRun(userId: number, question: string): Promise<DeliberationRun> {
  const run: DeliberationRun = {
    id:              `imr-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    userId,
    status:          "running",
    question,
    partialMessages: [],
    modifications:   [],
    createdAt:       Date.now(),
    interruptedAt:   null,
    resumedAt:       null,
  };
  await saveRun(run);
  return run;
}

/**
 * Interrupt a running deliberation.
 */
export async function interruptRun(
  userId: number,
  runId: string,
): Promise<DeliberationRun | null> {
  const run = await loadRun(userId, runId);
  if (!run) return null;
  if (run.status !== "running") {
    throw new Error(`Run ${runId} is not in running state (status: ${run.status})`);
  }
  run.status = "interrupted";
  run.interruptedAt = Date.now();
  await saveRun(run);
  return run;
}

/**
 * Apply a modification to an interrupted run.
 */
export async function modifyRun(
  userId: number,
  runId: string,
  modification: string,
): Promise<DeliberationRun | null> {
  const run = await loadRun(userId, runId);
  if (!run) return null;
  if (run.status !== "interrupted") {
    throw new Error(`Run ${runId} must be interrupted before modifying (status: ${run.status})`);
  }
  run.modifications.push(modification);
  await saveRun(run);
  return run;
}

/**
 * Resume an interrupted run (optionally with a question override).
 */
export async function resumeRun(
  userId: number,
  runId: string,
  questionOverride?: string,
): Promise<DeliberationRun | null> {
  const run = await loadRun(userId, runId);
  if (!run) return null;
  if (run.status !== "interrupted") {
    throw new Error(`Run ${runId} must be interrupted to resume (status: ${run.status})`);
  }
  if (questionOverride) run.question = questionOverride;
  run.status = "resumed";
  run.resumedAt = Date.now();
  await saveRun(run);
  return run;
}

/**
 * Cancel a run.
 */
export async function cancelRun(userId: number, runId: string): Promise<DeliberationRun | null> {
  const run = await loadRun(userId, runId);
  if (!run) return null;
  run.status = "cancelled";
  await saveRun(run);
  return run;
}

/**
 * Mark a run as completed.
 */
export async function completeRun(userId: number, runId: string): Promise<void> {
  const run = await loadRun(userId, runId);
  if (!run) return;
  run.status = "completed";
  await saveRun(run);
}

/**
 * Get a run by ID.
 */
export async function getRun(userId: number, runId: string): Promise<DeliberationRun | null> {
  return loadRun(userId, runId);
}

/**
 * List recent runs for a user.
 */
export async function listRuns(userId: number, limit = 20): Promise<DeliberationRun[]> {
  try {
    const runIds = await redis.zrevrange(userRunsKey(userId), 0, limit - 1);
    const runs = await Promise.all(runIds.map(id => loadRun(userId, Number(id))));
    return runs.filter((r): r is DeliberationRun => r !== null);
  } catch {
    return [];
  }
}
