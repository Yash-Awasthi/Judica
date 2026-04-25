/**
 * Highspot Connector — loads spots (content libraries), items, and pitches
 * from Highspot sales enablement platform.
 * Supports: LoadConnector.
 */

import type { BaseConnectorConfig, LoadConnector } from "../interfaces.js";
import type { ConnectorDocument, ConnectorFailure } from "../models.js";
import { DocumentSource, SectionType } from "../models.js";

export class HighspotConnector implements LoadConnector {
  readonly displayName = "Highspot";
  readonly sourceType = DocumentSource.HIGHSPOT;

  private config!: BaseConnectorConfig;
  private apiKey!: string;
  private spotIds: string[] = [];

  async init(config: BaseConnectorConfig): Promise<void> {
    this.config = config;
    this.spotIds = (config.settings.spot_ids as string[]) ?? [];
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
    // If no spotIds specified, fetch all spots
    let spotIds = this.spotIds;
    if (spotIds.length === 0) {
      try {
        const spots = (await this.highspotApi("/v1/spots")) as Record<string, unknown>;
        const spotsData = (spots.results ?? spots.data ?? []) as Array<Record<string, unknown>>;
        spotIds = spotsData.map((s) => String(s.id ?? s.spot_id));
      } catch (err) {
        yield { error: `Highspot spots list failed: ${(err as Error).message}` };
        return;
      }
    }

    for (const spotId of spotIds) {
      yield* this.fetchSpotItems(spotId);
    }
  }

  private async *fetchSpotItems(
    spotId: string,
  ): AsyncGenerator<ConnectorDocument[] | ConnectorFailure> {
    let cursor: string | null = null;
    let hasMore = true;

    while (hasMore) {
      try {
        const path = `/v1/spots/${spotId}/items${cursor ? `?cursor=${cursor}` : ""}`;
        const data = (await this.highspotApi(path)) as Record<string, unknown>;
        const items = (data.results ?? data.items ?? data.data ?? []) as Array<Record<string, unknown>>;

        if (!Array.isArray(items) || items.length === 0) break;

        const docs: ConnectorDocument[] = items.map((item) => {
          const description = (item.description ?? item.summary ?? item.excerpt ?? "") as string;
          return {
            id: `highspot:item:${item.id}`,
            source: DocumentSource.HIGHSPOT,
            title: (item.title ?? item.name ?? "Untitled Item") as string,
            sourceUrl: (item.url ?? item.source_url ?? `https://app.highspot.com/items/${item.id}`) as string,
            sections: [{ type: SectionType.TEXT as const, content: description }],
            metadata: {
              spotId,
              itemType: item.type ?? item.content_type,
              fileType: item.file_type,
              type: "item",
            },
            lastModifiedEpochSecs: item.updated_at ?? item.modified_at
              ? Math.floor(new Date((item.updated_at ?? item.modified_at) as string).getTime() / 1000)
              : undefined,
          };
        });

        if (docs.length > 0) yield docs;

        const pagination = data.pagination as Record<string, unknown> | undefined;
        cursor = (pagination?.next_cursor ?? data.next_cursor ?? null) as string | null;
        hasMore = !!cursor;
      } catch (err) {
        yield { error: `Highspot items fetch failed for spot ${spotId}: ${(err as Error).message}` };
        break;
      }
    }
  }

  private async highspotApi(path: string): Promise<unknown> {
    const url = `https://api.highspot.com${path}`;
    const resp = await fetch(url, {
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        Accept: "application/json",
      },
    });
    if (resp.status === 401 || resp.status === 403) {
      console.warn(`Highspot API auth error: ${resp.status}`);
      return { results: [] };
    }
    if (!resp.ok) throw new Error(`Highspot API error: ${resp.status} ${resp.statusText}`);
    return resp.json();
  }
}
