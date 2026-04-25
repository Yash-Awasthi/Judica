/**
 * Coda Connector — loads docs and pages from Coda.
 * Supports: LoadConnector.
 */
import type { BaseConnectorConfig, LoadConnector } from "../interfaces.js";
import type { ConnectorDocument, ConnectorFailure } from "../models.js";
import { DocumentSource, SectionType } from "../models.js";

export class CodaConnector implements LoadConnector {
  readonly displayName = "Coda";
  readonly sourceType = DocumentSource.CODA;
  private config!: BaseConnectorConfig;
  private apiToken!: string;

  async init(config: BaseConnectorConfig): Promise<void> { this.config = config; }
  async loadCredentials(credentials: Record<string, unknown>): Promise<void> { this.apiToken = credentials.api_token as string; }
  async validateSettings(): Promise<{ valid: boolean; errors: string[] }> {
    return { valid: !!this.apiToken, errors: this.apiToken ? [] : ["api_token is required"] };
  }

  async *loadFromState(): AsyncGenerator<ConnectorDocument[] | ConnectorFailure> {
    try {
      let pageToken: string | undefined;
      do {
        const params = new URLSearchParams({ limit: "100" });
        if (pageToken) params.set("pageToken", pageToken);
        const data = await this.codaApi(`/docs?${params}`);
        const items = (data.items ?? []) as Array<Record<string, unknown>>;
        const docs: ConnectorDocument[] = items.map((d) => ({
          id: `coda:${d.id}`, source: DocumentSource.CODA, title: (d.name as string) ?? "",
          sourceUrl: d.browserLink as string,
          sections: [{ type: SectionType.TEXT as const, content: `Coda Doc: ${d.name}\nOwner: ${(d.owner as string) ?? "unknown"}` }],
          metadata: { type: "doc", folderId: d.folderId },
          lastModifiedEpochSecs: d.updatedAt ? Math.floor(new Date(d.updatedAt as string).getTime() / 1000) : undefined,
        }));
        if (docs.length > 0) yield docs;
        pageToken = data.nextPageToken as string | undefined;
      } while (pageToken);
    } catch (err) { yield { error: `Coda fetch failed: ${(err as Error).message}` }; }
  }

  private async codaApi(path: string): Promise<Record<string, unknown>> {
    const resp = await fetch(`https://coda.io/apis/v1${path}`, {
      headers: { Authorization: `Bearer ${this.apiToken}`, Accept: "application/json" },
    });
    if (!resp.ok) throw new Error(`Coda API error: ${resp.status}`);
    return resp.json() as Promise<Record<string, unknown>>;
  }
}
