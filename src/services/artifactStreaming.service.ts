/**
 * Intermediate artifact streaming service.
 *
 * Enables real-time SSE streaming of partial results during
 * long-running agent tasks. Consumers subscribe to a stream ID
 * and receive typed events as artifacts are produced.
 *
 * P4-14: Redis Streams support for multi-replica deployments.
 * When Redis is available, artifacts are published to Redis Streams
 * for cross-process delivery. Falls back to in-memory EventEmitter
 * for single-process deployments.
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
 * Returns the created artifact with its sequence number.
 */
export function emitArtifact(
  streamId: string,
  type: ArtifactType,
  label: string,
  content: unknown,
  metadata?: Record<string, unknown>,
): Artifact | null {
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

  // Emit to local subscribers
  emitter.emit(`artifact:${streamId}`, artifact);

  // P4-14: Also publish to Redis Streams for multi-replica support
  try {
    await redis.xAdd(`artifact_stream:${streamId}`, "*", {
      data: JSON.stringify(artifact),
    });
  } catch {
    // Redis publish is best-effort; local EventEmitter is always the fallback
  }

  return artifact;
}

/**
 * Mark a stream as complete. No more artifacts can be emitted.
 */
export function completeStream(streamId: string, summary?: string): boolean {
  const stream = streams.get(streamId);
  if (!stream || stream.isComplete) return false;

  // Emit a final "complete" artifact
  emitArtifact(streamId, "complete", "Stream complete", summary ?? "All artifacts delivered");

  stream.isComplete = true;
  stream.completedAt = new Date();

  emitter.emit(`complete:${streamId}`);

  // P4-14: Publish completion to Redis and set TTL on the stream key
  try {
    await redis.xAdd(`artifact_stream:${streamId}`, "*", {
      data: JSON.stringify({ type: "stream_complete" }),
    });
    // Auto-expire Redis stream after 24h
    await redis.expire(`artifact_stream:${streamId}`, 86400);
  } catch {
    // Best-effort
  }

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
