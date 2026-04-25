/**
 * Zendesk Connector — loads tickets and articles from Zendesk.
 * Supports: LoadConnector, PollConnector.
 */

import type { BaseConnectorConfig, LoadConnector, PollConnector } from "../interfaces.js";
import type { ConnectorDocument, ConnectorFailure } from "../models.js";
import { DocumentSource, SectionType } from "../models.js";

export class ZendeskConnector implements LoadConnector, PollConnector {
  readonly displayName = "Zendesk";
  readonly sourceType = DocumentSource.ZENDESK;

  private config!: BaseConnectorConfig;
  private subdomain!: string;
  private email!: string;
  private apiToken!: string;
  private includeTickets = true;
  private includeArticles = true;

  async init(config: BaseConnectorConfig): Promise<void> {
    this.config = config;
    const s = config.settings;
    this.subdomain = s.subdomain as string;
    this.includeTickets = (s.include_tickets as boolean) ?? true;
    this.includeArticles = (s.include_articles as boolean) ?? true;
  }

  async loadCredentials(credentials: Record<string, unknown>): Promise<void> {
    this.email = credentials.email as string;
    this.apiToken = credentials.api_token as string;
  }

  async validateSettings(): Promise<{ valid: boolean; errors: string[] }> {
    const errors: string[] = [];
    if (!this.subdomain) errors.push("subdomain is required");
    if (!this.email) errors.push("email is required");
    if (!this.apiToken) errors.push("api_token is required");
    return { valid: errors.length === 0, errors };
  }

  async *loadFromState(): AsyncGenerator<ConnectorDocument[] | ConnectorFailure> {
    if (this.includeTickets) yield* this.fetchTickets();
    if (this.includeArticles) yield* this.fetchArticles();
  }

  async *pollSource(startEpochSecs: number): AsyncGenerator<ConnectorDocument[] | ConnectorFailure> {
    if (this.includeTickets) yield* this.fetchTickets(startEpochSecs);
    if (this.includeArticles) yield* this.fetchArticles(startEpochSecs);
  }

  private async *fetchTickets(sinceEpoch?: number): AsyncGenerator<ConnectorDocument[] | ConnectorFailure> {
    let url: string | null = sinceEpoch
      ? `/api/v2/incremental/tickets.json?start_time=${sinceEpoch}`
      : "/api/v2/tickets.json?page[size]=100";

    while (url) {
      try {
        const data = await this.zdApi(url);
        const tickets = (data.tickets ?? []) as Array<Record<string, unknown>>;
        if (tickets.length === 0) break;

        const docs: ConnectorDocument[] = tickets.map((t) => ({
          id: `zendesk:ticket:${t.id}`,
          source: DocumentSource.ZENDESK,
          title: `Ticket #${t.id}: ${t.subject ?? ""}`,
          sourceUrl: `https://${this.subdomain}.zendesk.com/agent/tickets/${t.id}`,
          sections: [{ type: SectionType.TEXT as const, content: (t.description as string) ?? "" }],
          metadata: { type: "ticket", status: t.status, priority: t.priority, tags: t.tags },
          lastModifiedEpochSecs: t.updated_at
            ? Math.floor(new Date(t.updated_at as string).getTime() / 1000)
            : undefined,
        }));

        if (docs.length > 0) yield docs;
        url = (data.next_page as string) ?? (data.links as Record<string, string>)?.next ?? null;
        if (url) url = url.replace(`https://${this.subdomain}.zendesk.com`, "");
        if (data.end_of_stream) break;
      } catch (err) {
        yield { error: `Zendesk ticket fetch failed: ${(err as Error).message}` };
        break;
      }
    }
  }

  private async *fetchArticles(sinceEpoch?: number): AsyncGenerator<ConnectorDocument[] | ConnectorFailure> {
    let url: string | null = "/api/v2/help_center/articles.json?page[size]=100";
    if (sinceEpoch) url += `&start_time=${sinceEpoch}`;

    while (url) {
      try {
        const data = await this.zdApi(url);
        const articles = (data.articles ?? []) as Array<Record<string, unknown>>;
        if (articles.length === 0) break;

        const docs: ConnectorDocument[] = articles.map((a) => ({
          id: `zendesk:article:${a.id}`,
          source: DocumentSource.ZENDESK,
          title: (a.title as string) ?? "",
          sourceUrl: a.html_url as string,
          sections: [{ type: SectionType.TEXT as const, content: (a.body as string) ?? "" }],
          metadata: { type: "article", sectionId: a.section_id, draft: a.draft, promoted: a.promoted },
          lastModifiedEpochSecs: a.updated_at
            ? Math.floor(new Date(a.updated_at as string).getTime() / 1000)
            : undefined,
        }));

        if (docs.length > 0) yield docs;
        url = (data.next_page as string) ?? null;
        if (url) url = url.replace(`https://${this.subdomain}.zendesk.com`, "");
      } catch (err) {
        yield { error: `Zendesk article fetch failed: ${(err as Error).message}` };
        break;
      }
    }
  }

  private async zdApi(path: string): Promise<Record<string, unknown>> {
    const base = `https://${this.subdomain}.zendesk.com`;
    const url = path.startsWith("http") ? path : `${base}${path}`;
    const auth = Buffer.from(`${this.email}/token:${this.apiToken}`).toString("base64");
    const resp = await fetch(url, {
      headers: { Authorization: `Basic ${auth}`, Accept: "application/json" },
    });
    if (!resp.ok) throw new Error(`Zendesk API error: ${resp.status} ${resp.statusText}`);
    return resp.json() as Promise<Record<string, unknown>>;
  }
}
