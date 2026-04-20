/**
 * Intermediate artifact streaming service.
 *
 * Enables real-time SSE streaming of partial results during
 * long-running agent tasks. Consumers subscribe to a stream ID
 * and receive typed events as artifacts are produced.
 *
 * P4-14: Redis Streams for multi-replica deployments.
 * Artifacts are published to Redis Streams for cross-process delivery.
 * Local EventEmitter provides low-latency same-process fan-out.
 * Falls back gracefully when Redis is unavailable.
 */

import crypto from "crypto";
import { EventEmitter } from "events";
import logger from "../lib/logger.js";
import redis from "../lib/redis.js";

// ─── Types ──────────────────────────────────────────────────────────────────

export type ArtifactType =
  | "text" | "code" | "table" | "chart" | "image"
  | "markdown" | "json" | "progress" | "error" | "complete";

export interface Artifact {
  id: string;
  streamId: string;
  type: ArtifactType;
  label: string;
  content: unknown;
  metadata?: Record<string, unknown>;
  sequence: number;
  timestamp: Date;
}

export interface StreamInfo {
  id: string;
  userId: number;
  agentId?: string;
  title: string;
  artifactCount: number;
  isComplete: boolean;
  createdAt: Date;
  completedAt: Date | null;
}

// ─── Internal State ─────────────────────────────────────────────────────────

const emitter = new EventEmitter();
emitter.setMaxListeners(100);

const streams = new Map<string, StreamInfo>();
const artifactStore = new Map<string, Artifact[]>();

// ─── Redis Stream Helpers ───────────────────────────────────────────────────

const STREAM_PREFIX = "artifact_stream:";
const STREAM_TTL_SECONDS = 86400; // 24h

async function publishToRedis(streamId: string, data: Record<string, string>): Promise<void> {
  try {
    await redis.xadd(`${STREAM_PREFIX}${streamId}`, "*", "data", data.data);
  } catch {
    // Redis publish is best-effort; local EventEmitter is the fallback
  }
}

async function setRedisExpiry(streamId: string): Promise<void> {
  try {
    await redis.expire(`${STREAM_PREFIX}${streamId}`, STREAM_TTL_SECONDS);
  } catch {
    // Best-effort
  }
}

// ─── Core Functions ─────────────────────────────────────────────────────────

/**
 * Create a new artifact stream.
 */
export function createStream(userId: number, title: string, agentId?: string): string {
  const id = `stream_${crypto.randomBytes(8).toString("hex")}`;

  streams.set(id, {
    id,
    userId,
    agentId,
    title,
    artifactCount: 0,
    isComplete: false,
    createdAt: new Date(),
    completedAt: null,
  });

  artifactStore.set(id, []);

  logger.info({ streamId: id, userId, title }, "Artifact stream created");
  return id;
}

/**
 * Emit an artifact to a stream.
 * Publishes to both local EventEmitter and Redis Streams.
 */
export async function emitArtifact(
  streamId: string,
  type: ArtifactType,
  label: string,
  content: unknown,
  metadata?: Record<string, unknown>,
): Promise<Artifact | null> {
  const stream = streams.get(streamId);
  if (!stream || stream.isComplete) return null;

  const artifacts = artifactStore.get(streamId)!;
  const artifact: Artifact = {
    id: `artifact_${crypto.randomBytes(6).toString("hex")}`,
    streamId,
    type,
    label,
    content,
    metadata,
    sequence: artifacts.length,
    timestamp: new Date(),
  };

  artifacts.push(artifact);
  stream.artifactCount = artifacts.length;

  // Emit to local subscribers (same-process, low-latency)
  emitter.emit(`artifact:${streamId}`, artifact);

  // Publish to Redis Streams for cross-replica delivery
  await publishToRedis(streamId, { data: JSON.stringify(artifact) });

  return artifact;
}

/**
 * Mark a stream as complete. No more artifacts can be emitted.
 */
export async function completeStream(streamId: string, summary?: string): Promise<boolean> {
  const stream = streams.get(streamId);
  if (!stream || stream.isComplete) return false;

  // Emit a final "complete" artifact
  await emitArtifact(streamId, "complete", "Stream complete", summary ?? "All artifacts delivered");

  stream.isComplete = true;
  stream.completedAt = new Date();

  emitter.emit(`complete:${streamId}`);

  // Publish completion to Redis and set TTL on the stream key
  await publishToRedis(streamId, { data: JSON.stringify({ type: "stream_complete" }) });
  await setRedisExpiry(streamId);

  logger.info({ streamId, artifactCount: stream.artifactCount }, "Artifact stream completed");
  return true;
}

/**
 * Subscribe to artifacts from a stream.
 *
 * Returns an unsubscribe function. The callback receives artifacts in order.
 * If `replay` is true, all existing artifacts are replayed first.
 */
export function subscribe(
  streamId: string,
  callback: (artifact: Artifact) => void,
  options?: { replay?: boolean },
): { unsubscribe: () => void } | null {
  const stream = streams.get(streamId);
  if (!stream) return null;

  // Replay existing artifacts
  if (options?.replay) {
    const existing = artifactStore.get(streamId) ?? [];
    for (const a of existing) {
      callback(a);
    }
  }

  const handler = (artifact: Artifact) => callback(artifact);
  emitter.on(`artifact:${streamId}`, handler);

  return {
    unsubscribe: () => {
      emitter.off(`artifact:${streamId}`, handler);
    },
  };
}

/**
 * Wait for a stream to complete.
 */
export function waitForCompletion(streamId: string, timeoutMs: number = 300_000): Promise<boolean> {
  const stream = streams.get(streamId);
  if (!stream) return Promise.resolve(false);
  if (stream.isComplete) return Promise.resolve(true);

  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      emitter.off(`complete:${streamId}`, handler);
      resolve(false);
    }, timeoutMs);

    const handler = () => {
      clearTimeout(timer);
      resolve(true);
    };

    emitter.once(`complete:${streamId}`, handler);
  });
}

/**
 * Get all artifacts from a stream.
 */
export function getArtifacts(streamId: string): Artifact[] {
  return artifactStore.get(streamId) ?? [];
}

/**
 * Get stream info.
 */
export function getStream(streamId: string): StreamInfo | undefined {
  return streams.get(streamId);
}

/**
 * List streams for a user.
 */
export function listStreams(userId: number): StreamInfo[] {
  return [...streams.values()]
    .filter((s) => s.userId === userId)
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}

/**
 * Format artifacts as SSE event string (for HTTP streaming).
 */
export function formatAsSSE(artifact: Artifact): string {
  const data = JSON.stringify({
    id: artifact.id,
    type: artifact.type,
    label: artifact.label,
    content: artifact.content,
    sequence: artifact.sequence,
    metadata: artifact.metadata,
  });
  return `event: artifact\ndata: ${data}\n\n`;
}

/**
 * Clean up old completed streams.
 */
export function cleanupStreams(maxAgeMs: number = 86400_000): number {
  const cutoff = Date.now() - maxAgeMs;
  let removed = 0;
  for (const [id, stream] of streams.entries()) {
    if (stream.isComplete && stream.createdAt.getTime() < cutoff) {
      streams.delete(id);
      artifactStore.delete(id);
      removed++;
    }
  }
  return removed;
}
