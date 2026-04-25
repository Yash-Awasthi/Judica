/**
 * Freshdesk Connector — loads tickets and knowledge base articles.
 * Supports: LoadConnector, PollConnector.
 */

import type { BaseConnectorConfig, LoadConnector, PollConnector } from "../interfaces.js";
import type { ConnectorDocument, ConnectorFailure } from "../models.js";
import { DocumentSource, SectionType } from "../models.js";

export class FreshdeskConnector implements LoadConnector, PollConnector {
  readonly displayName = "Freshdesk";
  readonly sourceType = DocumentSource.FRESHDESK;

  private config!: BaseConnectorConfig;
  private domain!: string;
  private apiKey!: string;

  async init(config: BaseConnectorConfig): Promise<void> {
    this.config = config;
    this.domain = config.settings.domain as string;
  }

  async loadCredentials(credentials: Record<string, unknown>): Promise<void> {
    this.apiKey = credentials.api_key as string;
  }

  async validateSettings(): Promise<{ valid: boolean; errors: string[] }> {
    const errors: string[] = [];
    if (!this.domain) errors.push("domain is required (e.g., yourcompany.freshdesk.com)");
    if (!this.apiKey) errors.push("api_key is required");
    return { valid: errors.length === 0, errors };
  }

  async *loadFromState(): AsyncGenerator<ConnectorDocument[] | ConnectorFailure> {
    yield* this.fetchTickets();
    yield* this.fetchSolutions();
  }

  async *pollSource(startEpochSecs: number): AsyncGenerator<ConnectorDocument[] | ConnectorFailure> {
    const since = new Date(startEpochSecs * 1000).toISOString();
    yield* this.fetchTickets(since);
    yield* this.fetchSolutions();
  }

  private async *fetchTickets(updatedSince?: string): AsyncGenerator<ConnectorDocument[] | ConnectorFailure> {
    let page = 1;
    let hasMore = true;

    while (hasMore) {
      try {
        let path = `/api/v2/tickets?per_page=100&page=${page}`;
        if (updatedSince) path += `&updated_since=${encodeURIComponent(updatedSince)}`;
        const tickets = (await this.fdApi(path)) as Array<Record<string, unknown>>;
        if (!Array.isArray(tickets) || tickets.length === 0) break;

        const docs: ConnectorDocument[] = tickets.map((t) => ({
          id: `freshdesk:ticket:${t.id}`,
          source: DocumentSource.FRESHDESK,
          title: `Ticket #${t.id}: ${t.subject ?? ""}`,
          sourceUrl: `https://${this.domain}/a/tickets/${t.id}`,
          sections: [{ type: SectionType.TEXT as const, content: (t.description_text as string) ?? "" }],
          metadata: { type: "ticket", status: t.status, priority: t.priority, tags: t.tags },
          lastModifiedEpochSecs: t.updated_at
            ? Math.floor(new Date(t.updated_at as string).getTime() / 1000)
            : undefined,
        }));

        if (docs.length > 0) yield docs;
        hasMore = tickets.length === 100;
        page++;
      } catch (err) {
        yield { error: `Freshdesk ticket fetch failed: ${(err as Error).message}` };
        break;
      }
    }
  }

  private async *fetchSolutions(): AsyncGenerator<ConnectorDocument[] | ConnectorFailure> {
    try {
      const categories = (await this.fdApi("/api/v2/solutions/categories")) as Array<Record<string, unknown>>;
      for (const cat of categories) {
        const folders = (await this.fdApi(`/api/v2/solutions/categories/${cat.id}/folders`)) as Array<Record<string, unknown>>;
        for (const folder of folders) {
          const articles = (await this.fdApi(`/api/v2/solutions/folders/${folder.id}/articles`)) as Array<Record<string, unknown>>;
          const docs: ConnectorDocument[] = articles.map((a) => ({
            id: `freshdesk:article:${a.id}`,
            source: DocumentSource.FRESHDESK,
            title: (a.title as string) ?? "",
            sourceUrl: `https://${this.domain}/a/solutions/articles/${a.id}`,
            sections: [{ type: SectionType.TEXT as const, content: (a.description_text as string) ?? (a.description as string) ?? "" }],
            metadata: { type: "article", category: cat.name, folder: folder.name, status: a.status },
            lastModifiedEpochSecs: a.updated_at
              ? Math.floor(new Date(a.updated_at as string).getTime() / 1000)
              : undefined,
          }));
          if (docs.length > 0) yield docs;
        }
      }
    } catch (err) {
      yield { error: `Freshdesk solutions fetch failed: ${(err as Error).message}` };
    }
  }

  private async fdApi(path: string): Promise<unknown> {
    const url = `https://${this.domain}${path}`;
    const auth = Buffer.from(`${this.apiKey}:X`).toString("base64");
    const resp = await fetch(url, {
      headers: { Authorization: `Basic ${auth}`, Accept: "application/json" },
    });
    if (!resp.ok) throw new Error(`Freshdesk API error: ${resp.status} ${resp.statusText}`);
    return resp.json();
  }
}
