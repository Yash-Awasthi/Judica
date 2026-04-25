/**
 * Loopio Connector — loads library entries (Q&A pairs, content blocks) from Loopio RFP platform.
 * Supports: LoadConnector.
 */

import type { BaseConnectorConfig, LoadConnector } from "../interfaces.js";
import type { ConnectorDocument, ConnectorFailure } from "../models.js";
import { DocumentSource, SectionType } from "../models.js";

export class LoopioConnector implements LoadConnector {
  readonly displayName = "Loopio";
  readonly sourceType = DocumentSource.LOOPIO;

  private config!: BaseConnectorConfig;
  private apiKey!: string;
  private instanceName!: string;

  async init(config: BaseConnectorConfig): Promise<void> {
    this.config = config;
    this.instanceName = config.settings.instance_name as string;
  }

  async loadCredentials(credentials: Record<string, unknown>): Promise<void> {
    this.apiKey = credentials.api_key as string;
  }

  async validateSettings(): Promise<{ valid: boolean; errors: string[] }> {
    const errors: string[] = [];
    if (!this.apiKey) errors.push("api_key is required");
    if (!this.instanceName) errors.push("instance_name is required");
    return { valid: errors.length === 0, errors };
  }

  async *loadFromState(): AsyncGenerator<ConnectorDocument[] | ConnectorFailure> {
    let page = 1;
    let hasMore = true;

    while (hasMore) {
      try {
        const data = (await this.loopioApi(`/api/v2/library/entries?page=${page}&per_page=100`)) as Record<string, unknown>;
        const entries = (data.data as Array<Record<string, unknown>>) ?? (data.entries as Array<Record<string, unknown>>) ?? [];

        if (!Array.isArray(entries) || entries.length === 0) break;

        const docs: ConnectorDocument[] = entries.map((entry) => {
          const question = (entry.question ?? entry.title ?? entry.name ?? "") as string;
          const answer = (entry.answer ?? entry.content ?? entry.body ?? "") as string;

          return {
            id: `loopio:entry:${entry.id}`,
            source: DocumentSource.LOOPIO,
            title: question || `Entry ${entry.id}`,
            sourceUrl: `https://app.loopio.com/library/entries/${entry.id}`,
            sections: [
              { type: SectionType.TEXT as const, content: `Q: ${question}\n\nA: ${answer}` },
            ],
            metadata: {
              category: entry.category,
              subcategory: entry.subcategory,
              tags: entry.tags,
              type: "library_entry",
            },
            lastModifiedEpochSecs: entry.updated_at
              ? Math.floor(new Date(entry.updated_at as string).getTime() / 1000)
              : undefined,
          };
        });

        if (docs.length > 0) yield docs;

        const meta = data.meta as Record<string, unknown> | undefined;
        const totalPages = (meta?.total_pages ?? meta?.last_page ?? 1) as number;
        hasMore = page < totalPages && entries.length === 100;
        page++;
      } catch (err) {
        yield { error: `Loopio library fetch failed: ${(err as Error).message}` };
        break;
      }
    }
  }

  private async loopioApi(path: string): Promise<unknown> {
    const url = `https://app.loopio.com${path}`;
    const resp = await fetch(url, {
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        Accept: "application/json",
        "X-Loopio-Instance": this.instanceName,
      },
    });
    if (resp.status === 401 || resp.status === 403) {
      console.warn(`Loopio API auth error: ${resp.status}`);
      return { data: [] };
    }
    if (!resp.ok) throw new Error(`Loopio API error: ${resp.status} ${resp.statusText}`);
    return resp.json();
  }
}
