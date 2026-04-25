/**
 * MediaWiki Connector — loads pages from MediaWiki installations.
 * Supports: LoadConnector, PollConnector.
 */
import type { BaseConnectorConfig, LoadConnector, PollConnector } from "../interfaces.js";
import type { ConnectorDocument, ConnectorFailure } from "../models.js";
import { DocumentSource, SectionType } from "../models.js";

export class MediaWikiConnector implements LoadConnector, PollConnector {
  readonly displayName = "MediaWiki";
  readonly sourceType = DocumentSource.MEDIAWIKI;
  private config!: BaseConnectorConfig;
  private baseUrl!: string;
  private categories: string[] = [];

  async init(config: BaseConnectorConfig): Promise<void> {
    this.config = config;
    this.baseUrl = (config.settings.base_url as string)?.replace(/\/$/, "") ?? "";
    this.categories = (config.settings.categories as string[]) ?? [];
  }
  async loadCredentials(): Promise<void> { /* MediaWiki public API, no credentials needed for most wikis */ }
  async validateSettings(): Promise<{ valid: boolean; errors: string[] }> {
    return { valid: !!this.baseUrl, errors: this.baseUrl ? [] : ["base_url is required"] };
  }

  async *loadFromState(): AsyncGenerator<ConnectorDocument[] | ConnectorFailure> { yield* this.fetchPages(); }
  async *pollSource(startEpochSecs: number): AsyncGenerator<ConnectorDocument[] | ConnectorFailure> { yield* this.fetchPages(startEpochSecs); }

  private async *fetchPages(sinceEpoch?: number): AsyncGenerator<ConnectorDocument[] | ConnectorFailure> {
    let apcontinue: string | undefined;
    do {
      try {
        const params: Record<string, string> = { action: "query", list: "allpages", aplimit: "50", format: "json" };
        if (apcontinue) params.apcontinue = apcontinue;
        const data = await this.mwApi(params);
        const pages = ((data.query as Record<string, unknown>)?.allpages ?? []) as Array<Record<string, unknown>>;

        const docs: ConnectorDocument[] = [];
        for (const page of pages) {
          try {
            const content = await this.mwApi({ action: "parse", pageid: String(page.pageid), prop: "wikitext", format: "json" });
            const text = ((content.parse as Record<string, unknown>)?.wikitext as Record<string, string>)?.["*"] ?? "";
            docs.push({
              id: `mediawiki:${page.pageid}`, source: DocumentSource.MEDIAWIKI, title: (page.title as string) ?? "",
              sourceUrl: `${this.baseUrl}/wiki/${encodeURIComponent((page.title as string) ?? "")}`,
              sections: [{ type: SectionType.TEXT as const, content: text }],
              metadata: { type: "page", namespace: page.ns },
            });
          } catch { /* skip individual page errors */ }
        }
        if (docs.length > 0) yield docs;
        apcontinue = (data.continue as Record<string, string>)?.apcontinue;
      } catch (err) { yield { error: `MediaWiki fetch failed: ${(err as Error).message}` }; break; }
    } while (apcontinue);
  }

  private async mwApi(params: Record<string, string>): Promise<Record<string, unknown>> {
    const url = new URL(`${this.baseUrl}/api.php`);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    const resp = await fetch(url.toString(), { headers: { Accept: "application/json" } });
    if (!resp.ok) throw new Error(`MediaWiki API error: ${resp.status}`);
    return resp.json() as Promise<Record<string, unknown>>;
  }
}
