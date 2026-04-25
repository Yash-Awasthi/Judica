/**
 * Vespa vector DB adapter.
 *
 * Implements the VectorDbAdapter interface using Vespa's Document API and
 * Query API. Vespa is Yahoo's open-source search platform used as a
 * high-performance alternative to pgvector for large-scale deployments.
 *
 * Vespa Document API: POST /document/v1/{namespace}/{schema}/docid/{id}
 * Vespa Query API:    POST /search/
 */

import type { VectorDbAdapter, VectorSearchResult } from "./vectorDb.adapter.js";
import logger from "../lib/logger.js";

export interface VespaDoc {
  id: string;
  content: string;
  title?: string;
  source?: string;
  tenantId?: string;
  userId?: number;
  embedding: number[];
  createdAt?: number;
}

export interface SearchOpts {
  topK?: number;
  filter?: Record<string, unknown>;
  namespace?: string;
  schema?: string;
}

export interface SearchResult {
  id: string;
  score: number;
  content: string;
  title?: string;
  source?: string;
  tenantId?: string;
  userId?: number;
}

export interface VespaConfig {
  endpoint: string;
  appName: string;
  namespace?: string;
}

interface VespaHit {
  id: string;
  relevance: number;
  fields: {
    id?: string;
    content?: string;
    title?: string;
    source?: string;
    tenantId?: string;
    userId?: number;
    [key: string]: unknown;
  };
}

interface VespaSearchResponse {
  root: {
    id: string;
    relevance: number;
    fields?: { totalCount?: number };
    children?: VespaHit[];
    errors?: Array<{ code: number; summary: string; message?: string }>;
  };
}

const DEFAULT_SCHEMA = "aibyai_doc";
const DEFAULT_NAMESPACE = "default";

export class VespaAdapter implements VectorDbAdapter {
  readonly name = "vespa";

  private readonly endpoint: string;
  private readonly appName: string;
  private readonly namespace: string;

  constructor(config: VespaConfig) {
    // Strip trailing slash to avoid double-slash in URLs
    this.endpoint = config.endpoint.replace(/\/$/, "");
    this.appName = config.appName;
    this.namespace = config.namespace ?? DEFAULT_NAMESPACE;
  }

  // ─── VectorDbAdapter interface ───────────────────────────────────────────

  async upsert(
    _collection: string,
    id: string,
    vector: number[],
    metadata: Record<string, unknown>,
  ): Promise<void> {
    const doc: VespaDoc = {
      id,
      content: (metadata.content as string) ?? "",
      title: metadata.title as string | undefined,
      source: metadata.source as string | undefined,
      tenantId: metadata.tenantId as string | undefined,
      userId: metadata.userId as number | undefined,
      embedding: vector,
      createdAt: (metadata.createdAt as number) ?? Date.now(),
    };
    await this.index([doc]);
  }

  async search(
    collection: string,
    queryVector: number[],
    topK: number,
    filter?: Record<string, unknown>,
  ): Promise<VectorSearchResult[]> {
    const results = await this.hybridSearch(
      "",
      queryVector,
      { topK, filter, schema: collection },
    );
    return results.map((r) => ({
      id: r.id,
      score: r.score,
      metadata: {
        content: r.content,
        title: r.title,
        source: r.source,
        tenantId: r.tenantId,
        userId: r.userId,
      },
    }));
  }

  async delete(collection: string, id: string): Promise<void> {
    await this.deleteByIds([id], collection);
  }

  async ping(): Promise<boolean> {
    const h = await this.health();
    return h.status === "up";
  }

  // ─── Vespa-specific methods ───────────────────────────────────────────────

  /**
   * Feed documents to Vespa using the Document API.
   * Uses PUT (create-or-replace) semantics per document.
   */
  async index(docs: VespaDoc[]): Promise<void> {
    const schema = DEFAULT_SCHEMA;
    const errors: string[] = [];

    await Promise.all(
      docs.map(async (doc) => {
        const url = `${this.endpoint}/document/v1/${this.namespace}/${schema}/docid/${encodeURIComponent(doc.id)}`;
        const body = {
          fields: {
            id: doc.id,
            content: doc.content,
            title: doc.title ?? "",
            source: doc.source ?? "",
            tenantId: doc.tenantId ?? "",
            userId: doc.userId ?? 0,
            embedding: { values: doc.embedding },
            createdAt: doc.createdAt ?? Date.now(),
          },
        };

        let res: Response;
        try {
          res = await fetch(url, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          });
        } catch (err) {
          errors.push(`Network error feeding doc ${doc.id}: ${String(err)}`);
          return;
        }

        if (!res.ok) {
          const text = await res.text().catch(() => "");
          errors.push(`Failed to index doc ${doc.id}: ${res.status} ${text}`);
        }
      }),
    );

    if (errors.length > 0) {
      throw new Error(`Vespa index errors:\n${errors.join("\n")}`);
    }
  }

  /**
   * BM25 text search via Vespa Query API (YQL).
   */
  async searchText(query: string, opts: SearchOpts = {}): Promise<SearchResult[]> {
    const schema = opts.schema ?? DEFAULT_SCHEMA;
    const limit = opts.topK ?? 10;
    const filterClause = this.buildFilterClause(opts.filter);

    const yql = `select * from ${schema} where userQuery()${filterClause} limit ${limit}`;

    const body: Record<string, unknown> = {
      yql,
      query,
      "ranking.profile": "default",
      hits: limit,
    };

    return this.executeQuery(body);
  }

  /**
   * Hybrid search: WAND (BM25) + ANN (approximate nearest neighbor) via YQL.
   * Uses nearestNeighbor() operator combined with userQuery().
   */
  async hybridSearch(
    query: string,
    embedding: number[],
    opts: SearchOpts = {},
  ): Promise<SearchResult[]> {
    const schema = opts.schema ?? DEFAULT_SCHEMA;
    const limit = opts.topK ?? 10;
    const filterClause = this.buildFilterClause(opts.filter);

    // Build hybrid YQL: userQuery() handles BM25, nearestNeighbor() handles ANN
    const hasText = query.trim().length > 0;
    const yql = hasText
      ? `select * from ${schema} where (userQuery() or nearestNeighbor(embedding, query_embedding))${filterClause} limit ${limit}`
      : `select * from ${schema} where nearestNeighbor(embedding, query_embedding)${filterClause} limit ${limit}`;

    const body: Record<string, unknown> = {
      yql,
      ...(hasText ? { query } : {}),
      "ranking.profile": "default",
      "input.query(query_embedding)": embedding,
      hits: limit,
      "ranking.matchPhase.maxHits": limit * 2,
    };

    return this.executeQuery(body);
  }

  /**
   * Delete documents by IDs using the Document API.
   */
  async deleteByIds(ids: string[], schema: string = DEFAULT_SCHEMA): Promise<void> {
    const errors: string[] = [];

    await Promise.all(
      ids.map(async (id) => {
        const url = `${this.endpoint}/document/v1/${this.namespace}/${schema}/docid/${encodeURIComponent(id)}`;

        let res: Response;
        try {
          res = await fetch(url, { method: "DELETE" });
        } catch (err) {
          errors.push(`Network error deleting doc ${id}: ${String(err)}`);
          return;
        }

        // 404 means already gone — treat as success
        if (!res.ok && res.status !== 404) {
          const text = await res.text().catch(() => "");
          errors.push(`Failed to delete doc ${id}: ${res.status} ${text}`);
        }
      }),
    );

    if (errors.length > 0) {
      throw new Error(`Vespa delete errors:\n${errors.join("\n")}`);
    }
  }

  /**
   * Check Vespa application health via ApplicationStatus endpoint.
   */
  async health(): Promise<{ status: string; documentsIndexed: number }> {
    const url = `${this.endpoint}/ApplicationStatus`;

    let res: Response;
    try {
      res = await fetch(url, { method: "GET" });
    } catch (err) {
      logger.warn({ err }, "Vespa health check failed");
      return { status: "down", documentsIndexed: 0 };
    }

    if (!res.ok) {
      return { status: "down", documentsIndexed: 0 };
    }

    // Attempt to get document count via metrics (best-effort)
    let documentsIndexed = 0;
    try {
      const metricsUrl = `${this.endpoint}/metrics/v2/values`;
      const metricsRes = await fetch(metricsUrl);
      if (metricsRes.ok) {
        const metrics = await metricsRes.json() as Record<string, unknown>;
        // Try to extract document count from Vespa metrics response
        const nodes = (metrics.nodes as Array<Record<string, unknown>>) ?? [];
        for (const node of nodes) {
          const services = (node.services as Array<Record<string, unknown>>) ?? [];
          for (const svc of services) {
            if ((svc.name as string)?.includes("searchnode")) {
              const metrics2 = (svc.metrics as Array<Record<string, unknown>>) ?? [];
              for (const m of metrics2) {
                const vals = m.values as Record<string, number> | undefined;
                if (vals?.["content.proton.documentdb.documents.active.last"] !== undefined) {
                  documentsIndexed += vals["content.proton.documentdb.documents.active.last"];
                }
              }
            }
          }
        }
      }
    } catch {
      // Metrics unavailable — not fatal
    }

    return { status: "up", documentsIndexed };
  }

  // ─── Private helpers ─────────────────────────────────────────────────────

  private async executeQuery(body: Record<string, unknown>): Promise<SearchResult[]> {
    const url = `${this.endpoint}/search/`;

    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch (err) {
      throw new Error(`Vespa query network error: ${String(err)}`, { cause: err });
    }

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Vespa query failed: ${res.status} ${text}`);
    }

    const data = (await res.json()) as VespaSearchResponse;

    if (data.root.errors && data.root.errors.length > 0) {
      const errMsg = data.root.errors.map((e) => e.message ?? e.summary).join("; ");
      throw new Error(`Vespa query errors: ${errMsg}`);
    }

    const hits = data.root.children ?? [];
    return hits.map((hit) => ({
      id: hit.fields.id ?? hit.id.split("::").pop() ?? hit.id,
      score: hit.relevance,
      content: (hit.fields.content as string) ?? "",
      title: hit.fields.title as string | undefined,
      source: hit.fields.source as string | undefined,
      tenantId: hit.fields.tenantId as string | undefined,
      userId: hit.fields.userId as number | undefined,
    }));
  }

  /**
   * Build a YQL filter clause from a metadata filter object.
   * Only supports simple key=value equality filters.
   */
  private buildFilterClause(filter?: Record<string, unknown>): string {
    if (!filter || Object.keys(filter).length === 0) return "";

    const parts = Object.entries(filter)
      .map(([key, value]) => {
        if (typeof value === "string") {
          // Escape single quotes by doubling them (Vespa YQL convention)
          const escaped = value.replace(/'/g, "''");
          return `${key} contains "${escaped}"`;
        }
        if (typeof value === "number" || typeof value === "boolean") {
          return `${key} = ${value}`;
        }
        return null;
      })
      .filter(Boolean);

    if (parts.length === 0) return "";
    return ` and (${parts.join(" and ")})`;
  }
}

/** Factory function for creating a VespaAdapter */
export function createVespaAdapter(config: VespaConfig): VespaAdapter {
  return new VespaAdapter(config);
}
