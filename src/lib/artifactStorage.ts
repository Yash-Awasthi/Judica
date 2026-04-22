/**
 * P4-34: Artifact storage abstraction.
 *
 * The current artifact streaming service stores artifacts in-memory (Map).
 * This module provides a pluggable storage interface so artifacts can be
 * persisted to S3, GCS, or other blob stores for durability and scale.
 *
 * Usage:
 *   import { getArtifactStore } from "./artifactStorage.js";
 *   await getArtifactStore().put(streamId, artifactId, data);
 *   const data = await getArtifactStore().get(streamId, artifactId);
 */

import logger from "./logger.js";

/** Maximum size of a single artifact (50 MB). */
const MAX_ARTIFACT_SIZE = 50 * 1024 * 1024; // 50MB

/** Maximum total number of artifacts stored in memory. */
const MAX_ARTIFACTS = 10_000;

export interface ArtifactStore {
  readonly name: string;

  /** Store an artifact blob. */
  put(streamId: string, artifactId: string, data: Buffer | string): Promise<void>;

  /** Retrieve an artifact blob. Returns null if not found. */
  get(streamId: string, artifactId: string): Promise<Buffer | null>;

  /** Delete all artifacts for a stream. */
  deleteStream(streamId: string): Promise<void>;

  /** List artifact IDs for a stream. */
  list(streamId: string): Promise<string[]>;
}

/**
 * In-memory artifact store — the current default.
 * Suitable for single-process deployments and development.
 */
// P19-08: Cap in-memory artifact store to prevent unbounded memory growth
const MAX_STREAMS = 500;
const MAX_ARTIFACTS_PER_STREAM = 100;

class InMemoryArtifactStore implements ArtifactStore {
  readonly name = "memory";
  private store = new Map<string, Map<string, Buffer>>();

  async put(streamId: string, artifactId: string, data: Buffer | string): Promise<void> {
    if (!this.store.has(streamId)) {
      // Evict oldest stream if at capacity
      if (this.store.size >= MAX_STREAMS) {
        const oldestKey = this.store.keys().next().value;
        if (oldestKey) this.store.delete(oldestKey);
      }
      this.store.set(streamId, new Map());
    }
    const streamMap = this.store.get(streamId)!;
    if (streamMap.size >= MAX_ARTIFACTS_PER_STREAM) {
      const oldestArtifact = streamMap.keys().next().value;
      if (oldestArtifact) streamMap.delete(oldestArtifact);
    }
    streamMap.set(artifactId, Buffer.from(data));
  }

  async get(streamId: string, artifactId: string): Promise<Buffer | null> {
    return this.store.get(streamId)?.get(artifactId) ?? null;
  }

  async deleteStream(streamId: string): Promise<void> {
    this.store.delete(streamId);
  }

  async list(streamId: string): Promise<string[]> {
    const m = this.store.get(streamId);
    return m ? Array.from(m.keys()) : [];
  }
}

/**
 * S3-compatible artifact store stub.
 * To use: set ARTIFACT_STORE=s3 and configure S3_BUCKET, AWS_REGION, etc.
 * Implementation requires @aws-sdk/client-s3 — install separately.
 */
class S3ArtifactStore implements ArtifactStore {
  readonly name = "s3";

  async put(_streamId: string, _artifactId: string, _data: Buffer | string): Promise<void> {
    // Requires @aws-sdk/client-s3 — stub for now
    throw new Error("S3 artifact store not yet implemented. Install @aws-sdk/client-s3 and configure.");
  }

  async get(_streamId: string, _artifactId: string): Promise<Buffer | null> {
    throw new Error("S3 artifact store not yet implemented.");
  }

  async deleteStream(_streamId: string): Promise<void> {
    throw new Error("S3 artifact store not yet implemented.");
  }

  async list(_streamId: string): Promise<string[]> {
    throw new Error("S3 artifact store not yet implemented.");
  }
}

let currentStore: ArtifactStore = new InMemoryArtifactStore();

/** Get the active artifact store. */
export function getArtifactStore(): ArtifactStore {
  return currentStore;
}

/** Set a custom artifact store (e.g., S3, GCS). */
export function setArtifactStore(store: ArtifactStore): void {
  logger.info({ store: store.name }, "Artifact store changed");
  currentStore = store;
}

/** Auto-configure based on ARTIFACT_STORE env var. */
export function initArtifactStore(): void {
  const storeType = process.env.ARTIFACT_STORE || "memory";
  switch (storeType) {
    case "s3":
      currentStore = new S3ArtifactStore();
      break;
    case "memory":
    default:
      currentStore = new InMemoryArtifactStore();
      break;
  }
  logger.info({ store: currentStore.name }, "Artifact store initialized");
}
