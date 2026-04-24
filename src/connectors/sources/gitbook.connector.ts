/**
 * GitBook Connector — loads spaces and pages from GitBook via API.
 * Supports: LoadConnector.
 */

import type { BaseConnectorConfig, LoadConnector } from "../interfaces.js";
import type { ConnectorDocument, ConnectorFailure } from "../models.js";
import { DocumentSource, SectionType } from "../models.js";

export class GitBookConnector implements LoadConnector {
  readonly displayName = "GitBook";
  readonly sourceType = DocumentSource.GITBOOK;

  private config!: BaseConnectorConfig;
  private apiToken!: string;
  private spaceIds: string[] = [];

  async init(config: BaseConnectorConfig): Promise<void> {
    this.config = config;
    this.spaceIds = (config.settings.space_ids as string[]) ?? [];
  }

  async loadCredentials(credentials: Record<string, unknown>): Promise<void> {
    this.apiToken = credentials.api_token as string;
  }

  async validateSettings(): Promise<{ valid: boolean; errors: string[] }> {
    const errors: string[] = [];
    if (!this.apiToken) errors.push("api_token is required");
    if (this.spaceIds.length === 0) errors.push("At least one space_id is required");
    return { valid: errors.length === 0, errors };
  }

  async *loadFromState(): AsyncGenerator<ConnectorDocument[] | ConnectorFailure> {
    for (const spaceId of this.spaceIds) {
      yield* this.fetchSpacePages(spaceId);
    }
  }

  private async *fetchSpacePages(spaceId: string): AsyncGenerator<ConnectorDocument[] | ConnectorFailure> {
    try {
      const content = await this.gbApi(`/spaces/${spaceId}/content`);
      const pages = (content.pages ?? []) as Array<Record<string, unknown>>;
      const docs: ConnectorDocument[] = pages.map((p) => ({
        id: `gitbook:${spaceId}:${p.id}`,
        source: DocumentSource.GITBOOK,
        title: (p.title as string) ?? "",
        sourceUrl: p.url as string ?? "",
        sections: [{ type: SectionType.TEXT as const, content: (p.markdown as string) ?? (p.description as string) ?? "" }],
        metadata: { type: "page", spaceId, path: p.path },
      }));
      if (docs.length > 0) yield docs;
    } catch (err) {
      yield { error: `GitBook fetch failed for space ${spaceId}: ${(err as Error).message}` };
    }
  }

  private async gbApi(path: string): Promise<Record<string, unknown>> {
    const resp = await fetch(`https://api.gitbook.com/v1${path}`, {
      headers: { Authorization: `Bearer ${this.apiToken}`, Accept: "application/json" },
    });
    if (!resp.ok) throw new Error(`GitBook API error: ${resp.status}`);
    return resp.json() as Promise<Record<string, unknown>>;
  }
}
