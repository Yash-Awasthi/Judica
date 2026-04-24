/**
 * Wikipedia Connector — loads articles from Wikipedia via its API.
 * Supports: LoadConnector.
 */
import type { BaseConnectorConfig, LoadConnector } from "../interfaces.js";
import type { ConnectorDocument, ConnectorFailure } from "../models.js";
import { DocumentSource, SectionType } from "../models.js";

export class WikipediaConnector implements LoadConnector {
  readonly displayName = "Wikipedia";
  readonly sourceType = DocumentSource.WIKIPEDIA;
  private config!: BaseConnectorConfig;
  private titles: string[] = [];
  private categories: string[] = [];
  private language = "en";

  async init(config: BaseConnectorConfig): Promise<void> {
    this.config = config;
    this.titles = (config.settings.titles as string[]) ?? [];
    this.categories = (config.settings.categories as string[]) ?? [];
    this.language = (config.settings.language as string) ?? "en";
  }
  async loadCredentials(): Promise<void> { /* Wikipedia is public */ }
  async validateSettings(): Promise<{ valid: boolean; errors: string[] }> {
    const errors: string[] = [];
    if (this.titles.length === 0 && this.categories.length === 0) errors.push("At least one title or category is required");
    return { valid: errors.length === 0, errors };
  }

  async *loadFromState(): AsyncGenerator<ConnectorDocument[] | ConnectorFailure> {
    for (const title of this.titles) {
      try {
        const data = await this.wpApi({ action: "query", titles: title, prop: "extracts|info", explaintext: "1", inprop: "url", format: "json" });
        const pages = Object.values((data.query as Record<string, unknown>)?.pages ?? {}) as Array<Record<string, unknown>>;
        const docs: ConnectorDocument[] = pages.filter((p) => !p.missing).map((p) => ({
          id: `wikipedia:${this.language}:${p.pageid}`, source: DocumentSource.WIKIPEDIA, title: (p.title as string) ?? "",
          sourceUrl: p.fullurl as string ?? `https://${this.language}.wikipedia.org/wiki/${encodeURIComponent((p.title as string) ?? "")}`,
          sections: [{ type: SectionType.TEXT as const, content: (p.extract as string) ?? "" }],
          metadata: { type: "article", language: this.language },
        }));
        if (docs.length > 0) yield docs;
      } catch (err) { yield { error: `Wikipedia fetch failed for "${title}": ${(err as Error).message}` }; }
    }

    for (const cat of this.categories) {
      try {
        const data = await this.wpApi({ action: "query", list: "categorymembers", cmtitle: `Category:${cat}`, cmlimit: "100", format: "json" });
        const members = ((data.query as Record<string, unknown>)?.categorymembers ?? []) as Array<Record<string, unknown>>;
        for (const m of members) {
          this.titles.push(m.title as string);
        }
      } catch { /* skip category errors */ }
    }
  }

  private async wpApi(params: Record<string, string>): Promise<Record<string, unknown>> {
    const url = new URL(`https://${this.language}.wikipedia.org/w/api.php`);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    const resp = await fetch(url.toString(), { headers: { Accept: "application/json" } });
    if (!resp.ok) throw new Error(`Wikipedia API error: ${resp.status}`);
    return resp.json() as Promise<Record<string, unknown>>;
  }
}
