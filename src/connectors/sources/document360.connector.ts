/**
 * Document360 Connector — loads knowledge base articles.
 * Supports: LoadConnector.
 */
import type { BaseConnectorConfig, LoadConnector } from "../interfaces.js";
import type { ConnectorDocument, ConnectorFailure } from "../models.js";
import { DocumentSource, SectionType } from "../models.js";

export class Document360Connector implements LoadConnector {
  readonly displayName = "Document360";
  readonly sourceType = DocumentSource.DOCUMENT360;
  private config!: BaseConnectorConfig;
  private apiToken!: string;

  async init(config: BaseConnectorConfig): Promise<void> { this.config = config; }
  async loadCredentials(credentials: Record<string, unknown>): Promise<void> { this.apiToken = credentials.api_token as string; }
  async validateSettings(): Promise<{ valid: boolean; errors: string[] }> {
    return { valid: !!this.apiToken, errors: this.apiToken ? [] : ["api_token is required"] };
  }

  async *loadFromState(): AsyncGenerator<ConnectorDocument[] | ConnectorFailure> {
    try {
      const data = await this.d360Api("/v2/articles");
      const articles = (data.data ?? []) as Array<Record<string, unknown>>;
      const docs: ConnectorDocument[] = articles.map((a) => ({
        id: `document360:${a.id}`, source: DocumentSource.DOCUMENT360, title: (a.title as string) ?? "",
        sourceUrl: a.public_url as string ?? "",
        sections: [{ type: SectionType.TEXT as const, content: (a.html_content as string) ?? (a.content as string) ?? "" }],
        metadata: { type: "article", categoryId: a.category_id, status: a.status },
        lastModifiedEpochSecs: a.modified_at ? Math.floor(new Date(a.modified_at as string).getTime() / 1000) : undefined,
      }));
      if (docs.length > 0) yield docs;
    } catch (err) { yield { error: `Document360 fetch failed: ${(err as Error).message}` }; }
  }

  private async d360Api(path: string): Promise<Record<string, unknown>> {
    const resp = await fetch(`https://apihub.document360.io${path}`, {
      headers: { api_token: this.apiToken, Accept: "application/json" },
    });
    if (!resp.ok) throw new Error(`Document360 API error: ${resp.status}`);
    return resp.json() as Promise<Record<string, unknown>>;
  }
}
