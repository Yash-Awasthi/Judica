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
  const checkpoint: AgentCheckpoint = {
    jobId,
    step,
    data,
    savedAt: new Date().toISOString(),
  };

  try {
    await redis.set(
      `${CHECKPOINT_PREFIX}${jobId}`,
      JSON.stringify(checkpoint),
      { EX: CHECKPOINT_TTL_SECS }
    );
    logger.debug({ jobId, step }, "Agent checkpoint saved");
  } catch (err) {
    logger.warn({ jobId, err: (err as Error).message }, "Failed to save agent checkpoint");
  }
}

/**
 * Load a checkpoint for a job.
 * Returns null if no checkpoint exists (job is fresh).
 */
export async function loadCheckpoint(jobId: string): Promise<AgentCheckpoint | null> {
  try {
    const raw = await redis.get(`${CHECKPOINT_PREFIX}${jobId}`);
    if (!raw) return null;
    return JSON.parse(raw) as AgentCheckpoint;
  } catch (err) {
    logger.warn({ jobId, err: (err as Error).message }, "Failed to load agent checkpoint");
    return null;
  }
}

/**
 * Clear a checkpoint after successful job completion.
 */
export async function clearCheckpoint(jobId: string): Promise<void> {
  try {
    await redis.del(`${CHECKPOINT_PREFIX}${jobId}`);
    logger.debug({ jobId }, "Agent checkpoint cleared");
  } catch (err) {
    logger.warn({ jobId, err: (err as Error).message }, "Failed to clear agent checkpoint");
  }
}

/**
 * Check if a checkpoint exists for a job.
 */
export async function hasCheckpoint(jobId: string): Promise<boolean> {
  try {
    const val = await redis.get(`${CHECKPOINT_PREFIX}${jobId}`);
    return val !== null;
  } catch {
    return false;
  }
}
