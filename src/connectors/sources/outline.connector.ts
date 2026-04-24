/**
 * Outline Connector — loads documents from Outline wiki.
 * Supports: LoadConnector, PollConnector.
 */

import type { BaseConnectorConfig, LoadConnector, PollConnector } from "../interfaces.js";
import type { ConnectorDocument, ConnectorFailure } from "../models.js";
import { DocumentSource, SectionType } from "../models.js";

export class OutlineConnector implements LoadConnector, PollConnector {
  readonly displayName = "Outline";
  readonly sourceType = DocumentSource.OUTLINE;

  private config!: BaseConnectorConfig;
  private baseUrl!: string;
  private apiToken!: string;

  async init(config: BaseConnectorConfig): Promise<void> {
    this.config = config;
    this.baseUrl = (config.settings.base_url as string)?.replace(/\/$/, "") ?? "https://app.getoutline.com";
  }

  async loadCredentials(credentials: Record<string, unknown>): Promise<void> {
    this.apiToken = credentials.api_token as string;
  }

  async validateSettings(): Promise<{ valid: boolean; errors: string[] }> {
    const errors: string[] = [];
    if (!this.apiToken) errors.push("api_token is required");
    return { valid: errors.length === 0, errors };
  }

  async *loadFromState(): AsyncGenerator<ConnectorDocument[] | ConnectorFailure> { yield* this.fetchDocs(); }
  async *pollSource(startEpochSecs: number): AsyncGenerator<ConnectorDocument[] | ConnectorFailure> { yield* this.fetchDocs(startEpochSecs); }

  private async *fetchDocs(sinceEpoch?: number): AsyncGenerator<ConnectorDocument[] | ConnectorFailure> {
    let offset = 0;
    let hasMore = true;
    while (hasMore) {
      try {
        const body: Record<string, unknown> = { limit: 100, offset };
        if (sinceEpoch) body.dateFilter = "updated_at";
        const data = await this.outlineApi("/api/documents.list", body);
        const documents = (data.data ?? []) as Array<Record<string, unknown>>;
        if (documents.length === 0) break;

        const docs: ConnectorDocument[] = documents
          .filter((d) => !sinceEpoch || (d.updatedAt && Math.floor(new Date(d.updatedAt as string).getTime() / 1000) >= sinceEpoch))
          .map((d) => ({
            id: `outline:${d.id}`,
            source: DocumentSource.OUTLINE,
            title: (d.title as string) ?? "",
            sourceUrl: d.url as string ?? `${this.baseUrl}/doc/${d.id}`,
            sections: [{ type: SectionType.TEXT as const, content: (d.text as string) ?? "" }],
            metadata: { type: "document", collectionId: d.collectionId, parentDocumentId: d.parentDocumentId },
            lastModifiedEpochSecs: d.updatedAt ? Math.floor(new Date(d.updatedAt as string).getTime() / 1000) : undefined,
            owners: d.createdBy ? [{ name: (d.createdBy as Record<string, unknown>).name as string }] : undefined,
          }));

        if (docs.length > 0) yield docs;
        hasMore = documents.length === 100;
        offset += 100;
      } catch (err) { yield { error: `Outline fetch failed: ${(err as Error).message}` }; break; }
    }
  }

  private async outlineApi(path: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
    const resp = await fetch(`${this.baseUrl}${path}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.apiToken}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!resp.ok) throw new Error(`Outline API error: ${resp.status}`);
    return resp.json() as Promise<Record<string, unknown>>;
  }
}
