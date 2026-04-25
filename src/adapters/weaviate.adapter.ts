/**
 * Weaviate vector DB adapter.
 *
 * Implements the VectorDbAdapter interface using Weaviate's REST API directly
 * (no SDK dependency). Weaviate is a vector-first database with native support
 * for hybrid (keyword + vector) search.
 *
 * REST endpoints used:
 *   POST   /v1/schema                        — create a class (collection)
 *   POST   /v1/batch/objects                 — batch upsert objects
 *   POST   /v1/graphql                       — hybrid search via GraphQL
 *   DELETE /v1/objects/{className}/{id}      — delete by ID
 *   GET    /v1/.well-known/ready             — health check
 */

import type { VectorDbAdapter, VectorSearchResult } from "./vectorDb.adapter.js";
import logger from "../lib/logger.js";

export interface WeaviateConfig {
  url: string;
  apiKey?: string;
  scheme?: "http" | "https";
}

export interface WeaviateProperty {
  name: string;
  dataType: string[];
  description?: string;
  moduleConfig?: Record<string, unknown>;
  indexInverted?: boolean;
  tokenization?: string;
}

export interface WeaviateObject {
  id?: string;
  class?: string;
  properties: Record<string, unknown>;
  vector?: number[];
}

export interface WeaviateHybridResult {
  id: string;
  score: number;
  properties: Record<string, unknown>;
}

interface WeaviateGraphQLResponse {
  data?: {
    Get?: Record<string, Array<Record<string, unknown>>>;
  };
  errors?: Array<{ message: string }>;
}

interface WeaviateBatchResponse {
  id?: string;
  class?: string;
  result?: { status?: string; errors?: { error?: Array<{ message: string }> } };
}

export class WeaviateAdapter implements VectorDbAdapter {
  readonly name = "weaviate";

  private readonly baseUrl: string;
  private readonly headers: Record<string, string>;

  constructor(config: WeaviateConfig) {
    const scheme = config.scheme ?? (config.url.startsWith("https") ? "https" : "http");
    // Strip existing scheme if present, then apply canonical one
    const hostPart = config.url.replace(/^https?:\/\//, "").replace(/\/$/, "");
    this.baseUrl = `${scheme}://${hostPart}`;

    this.headers = { "Content-Type": "application/json" };
    if (config.apiKey) {
      this.headers["Authorization"] = `Bearer ${config.apiKey}`;
    }
  }

  // ─── VectorDbAdapter interface ───────────────────────────────────────────

  async upsert(
    collection: string,
    id: string,
    vector: number[],
    metadata: Record<string, unknown>,
  ): Promise<void> {
    await this.upsertObjects(collection, [{ id, properties: metadata, vector }]);
  }

  async search(
    collection: string,
    queryVector: number[],
    topK: number,
    filter?: Record<string, unknown>,
  ): Promise<VectorSearchResult[]> {
    const results = await this.hybridSearch(collection, "", queryVector, topK, 0, filter);
    return results.map((r) => ({
      id: r.id,
      score: r.score,
      metadata: r.properties,
    }));
  }

  async delete(collection: string, id: string): Promise<void> {
    const url = `${this.baseUrl}/v1/objects/${encodeURIComponent(collection)}/${encodeURIComponent(id)}`;
    let res: Response;
    try {
      res = await fetch(url, { method: "DELETE", headers: this.headers });
    } catch (err) {
      throw new Error(`Weaviate delete network error: ${String(err)}`, { cause: err });
    }
    if (!res.ok && res.status !== 404) {
      const text = await res.text().catch(() => "");
      throw new Error(`Weaviate delete failed (${res.status}): ${text}`);
    }
  }

  async ping(): Promise<boolean> {
    const h = await this.health();
    return h.ready;
  }

  // ─── Weaviate-specific methods ────────────────────────────────────────────

  /**
   * Create a Weaviate class (collection / schema).
   * No-ops if the class already exists.
   */
  async createClass(
    className: string,
    properties: WeaviateProperty[],
    vectorizer: string = "none",
  ): Promise<void> {
    // Check if class exists first
    const checkUrl = `${this.baseUrl}/v1/schema/${encodeURIComponent(className)}`;
    try {
      const checkRes = await fetch(checkUrl, { headers: this.headers });
      if (checkRes.ok) {
        logger.debug({ className }, "Weaviate class already exists, skipping creation");
        return;
      }
    } catch {
      // Ignore — try to create
    }

    const url = `${this.baseUrl}/v1/schema`;
    const body = {
      class: className,
      vectorizer,
      properties,
    };

    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: this.headers,
        body: JSON.stringify(body),
      });
    } catch (err) {
      throw new Error(`Weaviate createClass network error: ${String(err)}`, { cause: err });
    }

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      // 422 with "already exists" is a race condition — not an error
      if (res.status === 422 && text.includes("already exists")) return;
      throw new Error(`Weaviate createClass failed (${res.status}): ${text}`);
    }
  }

  /**
   * Batch upsert objects into a Weaviate class.
   * Objects must include a vector when vectorizer is "none".
   */
  async upsertObjects(className: string, objects: WeaviateObject[]): Promise<void> {
    const url = `${this.baseUrl}/v1/batch/objects`;
    const body = {
      objects: objects.map((obj) => ({
        id: obj.id,
        class: obj.class ?? className,
        properties: obj.properties,
        ...(obj.vector ? { vector: obj.vector } : {}),
      })),
    };

    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: this.headers,
        body: JSON.stringify(body),
      });
    } catch (err) {
      throw new Error(`Weaviate upsert network error: ${String(err)}`, { cause: err });
    }

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Weaviate batch upsert failed (${res.status}): ${text}`);
    }

    const results = (await res.json()) as WeaviateBatchResponse[];
    const errors = results
      .filter((r) => r.result?.status === "FAILED")
      .flatMap((r) => r.result?.errors?.error?.map((e) => e.message) ?? []);

    if (errors.length > 0) {
      throw new Error(`Weaviate upsert partial errors:\n${errors.join("\n")}`);
    }
  }

  /**
   * Hybrid search using Weaviate's GraphQL endpoint.
   * Combines BM25 keyword search with vector ANN via the `hybrid` operator.
   *
   * @param className   Weaviate class to search
   * @param query       Text query for BM25 component
   * @param vector      Query embedding for ANN component
   * @param limit       Number of results to return
   * @param alpha       0 = pure BM25, 1 = pure vector, 0.5 = equal weight
   * @param filter      Optional where filter (Weaviate GraphQL filter object)
   */
  async hybridSearch(
    className: string,
    query: string,
    vector: number[],
    limit: number = 10,
    alpha: number = 0.5,
    filter?: Record<string, unknown>,
  ): Promise<WeaviateHybridResult[]> {
    const url = `${this.baseUrl}/v1/graphql`;

    // Build hybrid arguments
    const hybridArgs: Record<string, unknown> = {
      query,
      vector,
      alpha,
    };

    const whereClause = filter ? `, where: ${JSON.stringify(filter).replace(/"([^"]+)":/g, "$1:")}` : "";

    // Build the GraphQL query — we request _additional { id score } plus all properties
    const gql = `{
  Get {
    ${className}(
      hybrid: {
        query: ${JSON.stringify(hybridArgs.query as string)}
        vector: [${(hybridArgs.vector as number[]).join(",")}]
        alpha: ${alpha}
      }
      limit: ${limit}${whereClause}
    ) {
      _additional {
        id
        score
        explainScore
      }
    }
  }
}`;

    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: this.headers,
        body: JSON.stringify({ query: gql }),
      });
    } catch (err) {
      throw new Error(`Weaviate hybridSearch network error: ${String(err)}`, { cause: err });
    }

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Weaviate GraphQL failed (${res.status}): ${text}`);
    }

    const data = (await res.json()) as WeaviateGraphQLResponse;

    if (data.errors && data.errors.length > 0) {
      throw new Error(`Weaviate GraphQL errors: ${data.errors.map((e) => e.message).join("; ")}`);
    }

    const hits = data.data?.Get?.[className] ?? [];
    return hits.map((hit) => {
      const additional = hit._additional as { id?: string; score?: number } | undefined;
      const { _additional, ...properties } = hit;
      void _additional;
      return {
        id: additional?.id ?? "",
        score: additional?.score ?? 0,
        properties,
      };
    });
  }

  /**
   * Get Weaviate readiness status.
   */
  async health(): Promise<{ ready: boolean; version?: string }> {
    const url = `${this.baseUrl}/v1/.well-known/ready`;
    let res: Response;
    try {
      res = await fetch(url, { headers: this.headers });
    } catch {
      return { ready: false };
    }

    if (!res.ok) return { ready: false };

    // Also fetch version from /v1/meta
    try {
      const metaRes = await fetch(`${this.baseUrl}/v1/meta`, { headers: this.headers });
      if (metaRes.ok) {
        const meta = await metaRes.json() as { version?: string };
        return { ready: true, version: meta.version };
      }
    } catch {
      // Non-fatal
    }

    return { ready: true };
  }
}

/** Factory function for creating a WeaviateAdapter */
export function createWeaviateAdapter(config: WeaviateConfig): WeaviateAdapter {
  return new WeaviateAdapter(config);
}
