/**
 * Slab Connector — loads posts from Slab knowledge base.
 * Supports: LoadConnector.
 */
import type { BaseConnectorConfig, LoadConnector } from "../interfaces.js";
import type { ConnectorDocument, ConnectorFailure } from "../models.js";
import { DocumentSource, SectionType } from "../models.js";

export class SlabConnector implements LoadConnector {
  readonly displayName = "Slab";
  readonly sourceType = DocumentSource.SLAB;
  private config!: BaseConnectorConfig;
  private apiToken!: string;

  async init(config: BaseConnectorConfig): Promise<void> { this.config = config; }
  async loadCredentials(credentials: Record<string, unknown>): Promise<void> { this.apiToken = credentials.api_token as string; }
  async validateSettings(): Promise<{ valid: boolean; errors: string[] }> {
    return { valid: !!this.apiToken, errors: this.apiToken ? [] : ["api_token is required"] };
  }

  async *loadFromState(): AsyncGenerator<ConnectorDocument[] | ConnectorFailure> {
    try {
      const query = `{ posts(first: 100) { nodes { id title content updatedAt url } pageInfo { hasNextPage endCursor } } }`;
      const data = await this.slabGql(query);
      const posts = (((data.data as Record<string, unknown>)?.posts as Record<string, unknown>)?.nodes ?? []) as Array<Record<string, unknown>>;
      const docs: ConnectorDocument[] = posts.map((p) => ({
        id: `slab:${p.id}`, source: DocumentSource.SLAB, title: (p.title as string) ?? "",
        sourceUrl: p.url as string,
        sections: [{ type: SectionType.TEXT as const, content: (p.content as string) ?? "" }],
        metadata: { type: "post" },
        lastModifiedEpochSecs: p.updatedAt ? Math.floor(new Date(p.updatedAt as string).getTime() / 1000) : undefined,
      }));
      if (docs.length > 0) yield docs;
    } catch (err) { yield { error: `Slab fetch failed: ${(err as Error).message}` }; }
  }

  private async slabGql(query: string): Promise<Record<string, unknown>> {
    const resp = await fetch("https://api.slab.com/v1/graphql", {
      method: "POST",
      headers: { Authorization: this.apiToken, "Content-Type": "application/json" },
      body: JSON.stringify({ query }),
    });
    if (!resp.ok) throw new Error(`Slab API error: ${resp.status}`);
    return resp.json() as Promise<Record<string, unknown>>;
  }
}
