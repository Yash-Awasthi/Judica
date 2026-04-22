/**
 * P4-15: Redis-backed checkpoints for background agents.
 *
 * Background agents (research, ingestion, etc.) run via BullMQ workers.
 * If the process restarts, in-progress work is lost. This module provides
 * a checkpoint/restore mechanism using Redis to persist agent progress.
 *
 * Usage:
 *   await saveCheckpoint(jobId, { step: 3, partial: [...] });
 *   const cp = await loadCheckpoint(jobId);
 *   if (cp) resumeFrom(cp.step);
 *   await clearCheckpoint(jobId);
 */

import redis from "../lib/redis.js";
import logger from "../lib/logger.js";

const CHECKPOINT_PREFIX = "agent:checkpoint:";
const CHECKPOINT_TTL_SECS = 86400; // 24h — stale checkpoints are auto-cleaned

const SAFE_JOB_ID_RE = /^[a-zA-Z0-9._-]+$/;
const MAX_JOB_ID_LENGTH = 256;

/**
 * Validate and sanitize a jobId to prevent Redis key injection or
 * excessively long keys. Throws if the jobId is invalid.
 */
function validateJobId(jobId: string): string {
  if (!jobId || jobId.length > MAX_JOB_ID_LENGTH) {
    throw new Error(
      `Invalid jobId: must be between 1 and ${MAX_JOB_ID_LENGTH} characters, got ${jobId?.length ?? 0}`
    );
  }
  if (!SAFE_JOB_ID_RE.test(jobId)) {
    throw new Error(
      "Invalid jobId: must contain only alphanumeric characters, hyphens, underscores, and dots"
    );
  }
  return jobId;
}

export interface AgentCheckpoint {
  jobId: string;
  step: number;
  data: Record<string, unknown>;
  savedAt: string;
}

/**
 * Save a checkpoint for a running agent job.
 * Overwrites any previous checkpoint for the same jobId.
 */
export async function saveCheckpoint(
  jobId: string,
  data: Record<string, unknown>,
  step = 0
): Promise<void> {
  const safeId = validateJobId(jobId);
  const checkpoint: AgentCheckpoint = {
    jobId: safeId,
    step,
    data,
    savedAt: new Date().toISOString(),
  };

  try {
    await redis.set(
      `${CHECKPOINT_PREFIX}${safeId}`,
      JSON.stringify(checkpoint),
      { EX: CHECKPOINT_TTL_SECS }
    );
    logger.debug({ jobId: safeId, step }, "Agent checkpoint saved");
  } catch (err) {
    logger.warn({ jobId: safeId, err: (err as Error).message }, "Failed to save agent checkpoint");
  }
}

/**
 * Load a checkpoint for a job.
 * Returns null if no checkpoint exists (job is fresh).
 */
export async function loadCheckpoint(jobId: string): Promise<AgentCheckpoint | null> {
  const safeId = validateJobId(jobId);
  try {
    const raw = await redis.get(`${CHECKPOINT_PREFIX}${safeId}`);
    if (!raw) return null;
    return JSON.parse(raw) as AgentCheckpoint;
  } catch (err) {
    logger.warn({ jobId: safeId, err: (err as Error).message }, "Failed to load agent checkpoint");
    return null;
  }
}

/**
 * Clear a checkpoint after successful job completion.
 */
export async function clearCheckpoint(jobId: string): Promise<void> {
  const safeId = validateJobId(jobId);
  try {
    await redis.del(`${CHECKPOINT_PREFIX}${safeId}`);
    logger.debug({ jobId: safeId }, "Agent checkpoint cleared");
  } catch (err) {
    logger.warn({ jobId: safeId, err: (err as Error).message }, "Failed to clear agent checkpoint");
  }
}

/**
 * Check if a checkpoint exists for a job.
 */
export async function hasCheckpoint(jobId: string): Promise<boolean> {
  const safeId = validateJobId(jobId);
  try {
    const val = await redis.get(`${CHECKPOINT_PREFIX}${safeId}`);
    return val !== null;
  } catch {
    return false;
  }
}
