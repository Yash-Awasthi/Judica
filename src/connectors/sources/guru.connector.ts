/**
 * Guru Connector — loads cards from Guru knowledge base.
 * Supports: LoadConnector, PollConnector.
 */

import type { BaseConnectorConfig, LoadConnector, PollConnector } from "../interfaces.js";
import type { ConnectorDocument, ConnectorFailure } from "../models.js";
import { DocumentSource, SectionType } from "../models.js";

export class GuruConnector implements LoadConnector, PollConnector {
  readonly displayName = "Guru";
  readonly sourceType = DocumentSource.GURU;

  private config!: BaseConnectorConfig;
  private email!: string;
  private apiToken!: string;

  async init(config: BaseConnectorConfig): Promise<void> { this.config = config; }

  async loadCredentials(credentials: Record<string, unknown>): Promise<void> {
    this.email = credentials.email as string;
    this.apiToken = credentials.api_token as string;
  }

  async validateSettings(): Promise<{ valid: boolean; errors: string[] }> {
    const errors: string[] = [];
    if (!this.email) errors.push("email is required");
    if (!this.apiToken) errors.push("api_token is required");
    return { valid: errors.length === 0, errors };
  }

  async *loadFromState(): AsyncGenerator<ConnectorDocument[] | ConnectorFailure> { yield* this.fetchCards(); }
  async *pollSource(startEpochSecs: number): AsyncGenerator<ConnectorDocument[] | ConnectorFailure> { yield* this.fetchCards(startEpochSecs); }

  private async *fetchCards(sinceEpoch?: number): AsyncGenerator<ConnectorDocument[] | ConnectorFailure> {
    try {
      const body: Record<string, unknown> = { queryType: "cards" };
      if (sinceEpoch) body.lastModified = new Date(sinceEpoch * 1000).toISOString();
      const data = await this.guruApi("/api/v1/search/cardmgr", body);
      const cards = (Array.isArray(data) ? data : []) as Array<Record<string, unknown>>;

      const docs: ConnectorDocument[] = cards.map((c) => ({
        id: `guru:${c.id}`,
        source: DocumentSource.GURU,
        title: (c.preferredPhrase as string) ?? "",
        sourceUrl: c.shareUrl as string ?? "",
        sections: [{ type: SectionType.TEXT as const, content: (c.content as string) ?? "" }],
        metadata: { type: "card", collection: (c.collection as Record<string, unknown>)?.name, verified: c.verificationState },
        lastModifiedEpochSecs: c.lastModified ? Math.floor(new Date(c.lastModified as string).getTime() / 1000) : undefined,
        owners: c.owner ? [{ name: (c.owner as Record<string, unknown>).firstName as string, email: (c.owner as Record<string, unknown>).email as string }] : undefined,
      }));

      if (docs.length > 0) yield docs;
    } catch (err) { yield { error: `Guru fetch failed: ${(err as Error).message}` }; }
  }

  private async guruApi(path: string, body: Record<string, unknown>): Promise<unknown> {
    const auth = Buffer.from(`${this.email}:${this.apiToken}`).toString("base64");
    const resp = await fetch(`https://api.getguru.com${path}`, {
      method: "POST",
      headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!resp.ok) throw new Error(`Guru API error: ${resp.status}`);
    return resp.json();
  }
}
