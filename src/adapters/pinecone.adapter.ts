/**
 * Pinecone vector DB adapter.
 *
 * Implements the VectorDbAdapter interface using Pinecone's REST API v1 directly
 * via fetch (no SDK dependency).
 *
 * Pinecone API base: https://api.pinecone.io  (control plane)
 * Index operations:  https://{index-host}     (data plane, per-index host)
 *
 * Endpoints used:
 *   GET  /indexes                             — list indexes
 *   GET  /indexes/{name}                      — describe index (get host)
 *   POST {host}/vectors/upsert                — upsert vectors
 *   POST {host}/query                         — query nearest neighbors
 *   POST {host}/vectors/delete                — delete vectors
 */

import type { VectorDbAdapter, VectorSearchResult } from "./vectorDb.adapter.js";
import logger from "../lib/logger.js";

export interface PineconeConfig {
  apiKey: string;
  environment: string;
  indexName: string;
}

export interface PineconeVector {
  id: string;
  values: number[];
  metadata?: Record<string, unknown>;
  sparseValues?: { indices: number[]; values: number[] };
}

export interface PineconeQueryMatch {
  id: string;
  score: number;
  values?: number[];
  metadata?: Record<string, unknown>;
}

export interface PineconeIndexDescription {
  name: string;
  dimension: number;
  metric: string;
  host: string;
  spec: {
    pod?: { environment: string; podType: string; replicas: number };
    serverless?: { cloud: string; region: string };
  };
  status: { ready: boolean; state: string };
}

export interface PineconeListIndexesResponse {
  indexes?: PineconeIndexDescription[];
}

const PINECONE_CONTROL_PLANE = "https://api.pinecone.io";

export class PineconeAdapter implements VectorDbAdapter {
  readonly name = "pinecone";

  private readonly apiKey: string;
  private readonly environment: string;
  private readonly indexName: string;
  private readonly controlPlaneHeaders: Record<string, string>;

  // Lazily resolved data-plane host (per-index URL)
  private _indexHost: string | null = null;

  constructor(config: PineconeConfig) {
    this.apiKey = config.apiKey;
    this.environment = config.environment;
    this.indexName = config.indexName;
    this.controlPlaneHeaders = {
      "Api-Key": config.apiKey,
      "Content-Type": "application/json",
      "X-Pinecone-API-Version": "2024-07",
    };
  }

  // ─── VectorDbAdapter interface ───────────────────────────────────────────

  async upsert(
    _collection: string,
    id: string,
    vector: number[],
    metadata: Record<string, unknown>,
  ): Promise<void> {
    await this.upsertVectors([{ id, values: vector, metadata }]);
  }

  async search(
    _collection: string,
    queryVector: number[],
    topK: number,
    filter?: Record<string, unknown>,
  ): Promise<VectorSearchResult[]> {
    const matches = await this.query(queryVector, topK, filter);
    return matches.map((m) => ({
      id: m.id,
      score: m.score,
      metadata: m.metadata ?? {},
    }));
  }

  async delete(_collection: string, id: string): Promise<void> {
    await this.deleteVectors([id]);
  }

  async ping(): Promise<boolean> {
    try {
      const desc = await this.describeIndex();
      return desc.status?.ready ?? false;
    } catch {
      return false;
    }
  }

  // ─── Pinecone-specific methods ────────────────────────────────────────────

  /**
   * Upsert vectors into the configured index.
   * Batches in groups of 100 (Pinecone's recommended batch size).
   */
  async upsertVectors(vectors: PineconeVector[]): Promise<void> {
    const host = await this.resolveIndexHost();
    const BATCH_SIZE = 100;

    for (let i = 0; i < vectors.length; i += BATCH_SIZE) {
      const batch = vectors.slice(i, i + BATCH_SIZE);
      const url = `https://${host}/vectors/upsert`;

      let res: Response;
      try {
        res = await fetch(url, {
          method: "POST",
          headers: this.dataPlaneHeaders(),
          body: JSON.stringify({ vectors: batch }),
        });
      } catch (err) {
        throw new Error(`Pinecone upsert network error: ${String(err)}`, { cause: err });
      }

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`Pinecone upsert failed (${res.status}): ${text}`);
      }
    }
  }

  /**
   * Query the index for nearest neighbor vectors.
   *
   * @param embedding   Query vector
   * @param topK        Number of results
   * @param filter      Metadata filter (Pinecone filter expression object)
   * @param includeValues  Whether to return vector values in results
   * @param includeMetadata  Whether to return metadata in results (default: true)
   */
  async query(
    embedding: number[],
    topK: number = 10,
    filter?: Record<string, unknown>,
    includeValues: boolean = false,
    includeMetadata: boolean = true,
  ): Promise<PineconeQueryMatch[]> {
    const host = await this.resolveIndexHost();
    const url = `https://${host}/query`;

    const body: Record<string, unknown> = {
      vector: embedding,
      topK,
      includeValues,
      includeMetadata,
    };
    if (filter && Object.keys(filter).length > 0) {
      body.filter = filter;
    }

    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: this.dataPlaneHeaders(),
        body: JSON.stringify(body),
      });
    } catch (err) {
      throw new Error(`Pinecone query network error: ${String(err)}`, { cause: err });
    }

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Pinecone query failed (${res.status}): ${text}`);
    }

    const data = await res.json() as { matches?: PineconeQueryMatch[] };
    return data.matches ?? [];
  }

  /**
   * Delete vectors from the index by ID.
   */
  async deleteVectors(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    const host = await this.resolveIndexHost();
    const url = `https://${host}/vectors/delete`;

    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: this.dataPlaneHeaders(),
        body: JSON.stringify({ ids }),
      });
    } catch (err) {
      throw new Error(`Pinecone delete network error: ${String(err)}`, { cause: err });
    }

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Pinecone delete failed (${res.status}): ${text}`);
    }
  }

  /**
   * Describe the configured index (metadata, host, status).
   */
  async describeIndex(): Promise<PineconeIndexDescription> {
    const url = `${PINECONE_CONTROL_PLANE}/indexes/${encodeURIComponent(this.indexName)}`;

    let res: Response;
    try {
      res = await fetch(url, { headers: this.controlPlaneHeaders });
    } catch (err) {
      throw new Error(`Pinecone describeIndex network error: ${String(err)}`, { cause: err });
    }

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Pinecone describeIndex failed (${res.status}): ${text}`);
    }

    return res.json() as Promise<PineconeIndexDescription>;
  }

  /**
   * List all indexes in the project.
   */
  async listIndexes(): Promise<PineconeIndexDescription[]> {
    const url = `${PINECONE_CONTROL_PLANE}/indexes`;

    let res: Response;
    try {
      res = await fetch(url, { headers: this.controlPlaneHeaders });
    } catch (err) {
      throw new Error(`Pinecone listIndexes network error: ${String(err)}`, { cause: err });
    }

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Pinecone listIndexes failed (${res.status}): ${text}`);
    }

    const data = (await res.json()) as PineconeListIndexesResponse;
    return data.indexes ?? [];
  }

  // ─── Private helpers ─────────────────────────────────────────────────────

  /**
   * Resolve the data-plane host for the configured index.
   * Caches after first successful lookup.
   */
  private async resolveIndexHost(): Promise<string> {
    if (this._indexHost) return this._indexHost;

    try {
      const desc = await this.describeIndex();
      if (!desc.host) {
        throw new Error("Pinecone index description missing host field");
      }
      this._indexHost = desc.host;
      logger.debug({ indexName: this.indexName, host: this._indexHost }, "Pinecone index host resolved");
      return this._indexHost;
    } catch (err) {
      // Fallback: construct host from environment + index name (legacy pods)
      const legacyHost = `${this.indexName}-${this.environment}.svc.pinecone.io`;
      logger.warn({ err, legacyHost }, "Pinecone describeIndex failed, falling back to legacy host format");
      this._indexHost = legacyHost;
      return legacyHost;
    }
  }

  private dataPlaneHeaders(): Record<string, string> {
    return {
      "Api-Key": this.apiKey,
      "Content-Type": "application/json",
    };
  }
}

/** Factory function for creating a PineconeAdapter */
export function createPineconeAdapter(config: PineconeConfig): PineconeAdapter {
  return new PineconeAdapter(config);
}
