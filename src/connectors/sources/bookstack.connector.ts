/**
 * BookStack Connector — loads books, chapters, and pages.
 * Supports: LoadConnector, PollConnector.
 */

import type { BaseConnectorConfig, LoadConnector, PollConnector } from "../interfaces.js";
import type { ConnectorDocument, ConnectorFailure } from "../models.js";
import { DocumentSource, SectionType } from "../models.js";

export class BookStackConnector implements LoadConnector, PollConnector {
  readonly displayName = "BookStack";
  readonly sourceType = DocumentSource.BOOKSTACK;

  private config!: BaseConnectorConfig;
  private baseUrl!: string;
  private tokenId!: string;
  private tokenSecret!: string;

  async init(config: BaseConnectorConfig): Promise<void> {
    this.config = config;
    this.baseUrl = (config.settings.base_url as string)?.replace(/\/$/, "") ?? "";
  }

  async loadCredentials(credentials: Record<string, unknown>): Promise<void> {
    this.tokenId = credentials.token_id as string;
    this.tokenSecret = credentials.token_secret as string;
  }

  async validateSettings(): Promise<{ valid: boolean; errors: string[] }> {
    const errors: string[] = [];
    if (!this.baseUrl) errors.push("base_url is required");
    if (!this.tokenId || !this.tokenSecret) errors.push("token_id and token_secret are required");
    return { valid: errors.length === 0, errors };
  }

  async *loadFromState(): AsyncGenerator<ConnectorDocument[] | ConnectorFailure> { yield* this.fetchPages(); }
  async *pollSource(startEpochSecs: number): AsyncGenerator<ConnectorDocument[] | ConnectorFailure> { yield* this.fetchPages(startEpochSecs); }

  private async *fetchPages(sinceEpoch?: number): AsyncGenerator<ConnectorDocument[] | ConnectorFailure> {
    let offset = 0;
    let hasMore = true;
    while (hasMore) {
      try {
        const data = await this.bsApi(`/api/pages?count=100&offset=${offset}`);
        const pages = (data.data ?? []) as Array<Record<string, unknown>>;
        if (pages.length === 0) break;

        const docs: ConnectorDocument[] = [];
        for (const page of pages) {
          if (sinceEpoch && page.updated_at) {
            if (Math.floor(new Date(page.updated_at as string).getTime() / 1000) < sinceEpoch) continue;
          }
          const full = await this.bsApi(`/api/pages/${page.id}`);
          docs.push({
            id: `bookstack:page:${page.id}`,
            source: DocumentSource.BOOKSTACK,
            title: (page.name as string) ?? "",
            sourceUrl: `${this.baseUrl}/books/${(full as Record<string, unknown>).book_slug}/page/${page.slug}`,
            sections: [{ type: SectionType.TEXT, content: ((full as Record<string, unknown>).markdown as string) ?? ((full as Record<string, unknown>).html as string) ?? "" }],
            metadata: { type: "page", bookId: page.book_id, chapterId: page.chapter_id },
            lastModifiedEpochSecs: page.updated_at ? Math.floor(new Date(page.updated_at as string).getTime() / 1000) : undefined,
          });
        }
        if (docs.length > 0) yield docs;
        hasMore = pages.length === 100;
        offset += 100;
      } catch (err) { yield { error: `BookStack fetch failed: ${(err as Error).message}` }; break; }
    }
  }

  private async bsApi(path: string): Promise<Record<string, unknown>> {
    const resp = await fetch(`${this.baseUrl}${path}`, {
      headers: { Authorization: `Token ${this.tokenId}:${this.tokenSecret}`, Accept: "application/json" },
    });
    if (!resp.ok) throw new Error(`BookStack API error: ${resp.status}`);
    return resp.json() as Promise<Record<string, unknown>>;
  }
}
