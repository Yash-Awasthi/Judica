/**
 * ProductBoard Connector — loads features, notes, and customer feedback
 * from ProductBoard product management platform.
 * Supports: LoadConnector.
 */

import type { BaseConnectorConfig, LoadConnector } from "../interfaces.js";
import type { ConnectorDocument, ConnectorFailure } from "../models.js";
import { DocumentSource, SectionType } from "../models.js";

export class ProductBoardConnector implements LoadConnector {
  readonly displayName = "ProductBoard";
  readonly sourceType = DocumentSource.PRODUCTBOARD;

  private config!: BaseConnectorConfig;
  private apiKey!: string;
  private workspaceId?: string;

  async init(config: BaseConnectorConfig): Promise<void> {
    this.config = config;
    this.workspaceId = config.settings.workspace_id as string | undefined;
  }

  async loadCredentials(credentials: Record<string, unknown>): Promise<void> {
    this.apiKey = credentials.api_key as string;
  }

  async validateSettings(): Promise<{ valid: boolean; errors: string[] }> {
    const errors: string[] = [];
    if (!this.apiKey) errors.push("api_key is required");
    return { valid: errors.length === 0, errors };
  }

  async *loadFromState(): AsyncGenerator<ConnectorDocument[] | ConnectorFailure> {
    yield* this.fetchFeatures();
    yield* this.fetchNotes();
  }

  private async *fetchFeatures(): AsyncGenerator<ConnectorDocument[] | ConnectorFailure> {
    let cursor: string | null = null;
    let hasMore = true;

    while (hasMore) {
      try {
        const params: Record<string, string> = { "page[limit]": "100" };
        if (cursor) params["page[cursor]"] = cursor;

        const data = (await this.productboardApi("/features", params)) as Record<string, unknown>;
        const features = (data.data as Array<Record<string, unknown>>) ?? [];

        if (!Array.isArray(features) || features.length === 0) break;

        const docs: ConnectorDocument[] = features.map((feature) => {
          const description = (feature.description ?? feature.summary ?? "") as string;
          return {
            id: `productboard:feature:${feature.id}`,
            source: DocumentSource.PRODUCTBOARD,
            title: (feature.name ?? feature.title ?? "Untitled Feature") as string,
            sourceUrl: (feature.links as Record<string, unknown>)?.html as string
              ?? `https://app.productboard.com/features/${feature.id}`,
            sections: [{ type: SectionType.TEXT as const, content: description }],
            metadata: {
              status: feature.status,
              type: "feature",
              featureType: feature.type,
            },
            lastModifiedEpochSecs: feature.updatedAt ?? feature.updated_at
              ? Math.floor(new Date((feature.updatedAt ?? feature.updated_at) as string).getTime() / 1000)
              : undefined,
          };
        });

        if (docs.length > 0) yield docs;

        const pagination = data.pageCursor as string | undefined;
        cursor = pagination ?? null;
        hasMore = !!cursor;
      } catch (err) {
        yield { error: `ProductBoard features fetch failed: ${(err as Error).message}` };
        break;
      }
    }
  }

  private async *fetchNotes(): AsyncGenerator<ConnectorDocument[] | ConnectorFailure> {
    let cursor: string | null = null;
    let hasMore = true;

    while (hasMore) {
      try {
        const params: Record<string, string> = { "page[limit]": "100" };
        if (cursor) params["page[cursor]"] = cursor;

        const data = (await this.productboardApi("/notes", params)) as Record<string, unknown>;
        const notes = (data.data as Array<Record<string, unknown>>) ?? [];

        if (!Array.isArray(notes) || notes.length === 0) break;

        const docs: ConnectorDocument[] = notes.map((note) => ({
          id: `productboard:note:${note.id}`,
          source: DocumentSource.PRODUCTBOARD,
          title: (note.title ?? "Customer Note") as string,
          sourceUrl: (note.links as Record<string, unknown>)?.html as string
            ?? `https://app.productboard.com/notes/${note.id}`,
          sections: [{ type: SectionType.TEXT as const, content: (note.content ?? note.body ?? "") as string }],
          metadata: {
            type: "note",
            source: note.source,
            companyId: (note.company as Record<string, unknown>)?.id,
            userId: (note.user as Record<string, unknown>)?.id,
          },
          lastModifiedEpochSecs: note.updatedAt ?? note.updated_at
            ? Math.floor(new Date((note.updatedAt ?? note.updated_at) as string).getTime() / 1000)
            : undefined,
        }));

        if (docs.length > 0) yield docs;

        cursor = (data.pageCursor as string | undefined) ?? null;
        hasMore = !!cursor;
      } catch (err) {
        yield { error: `ProductBoard notes fetch failed: ${(err as Error).message}` };
        break;
      }
    }
  }

  private async productboardApi(path: string, params?: Record<string, string>): Promise<unknown> {
    const url = new URL(`https://api.productboard.com${path}`);
    if (params) for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    const resp = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        Accept: "application/json",
        "X-Version": "1",
      },
    });
    if (resp.status === 401 || resp.status === 403) {
      console.warn(`ProductBoard API auth error: ${resp.status}`);
      return { data: [] };
    }
    if (!resp.ok) throw new Error(`ProductBoard API error: ${resp.status} ${resp.statusText}`);
    return resp.json();
  }
}
