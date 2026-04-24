/**
 * XenForo Connector — loads threads and posts from XenForo forums.
 * Supports: LoadConnector.
 */
import type { BaseConnectorConfig, LoadConnector } from "../interfaces.js";
import type { ConnectorDocument, ConnectorFailure } from "../models.js";
import { DocumentSource, SectionType } from "../models.js";

export class XenForoConnector implements LoadConnector {
  readonly displayName = "XenForo";
  readonly sourceType = DocumentSource.XENFORO;
  private config!: BaseConnectorConfig;
  private baseUrl!: string;
  private apiKey!: string;

  async init(config: BaseConnectorConfig): Promise<void> {
    this.config = config;
    this.baseUrl = (config.settings.base_url as string)?.replace(/\/$/, "") ?? "";
  }
  async loadCredentials(credentials: Record<string, unknown>): Promise<void> { this.apiKey = credentials.api_key as string; }
  async validateSettings(): Promise<{ valid: boolean; errors: string[] }> {
    const errors: string[] = [];
    if (!this.baseUrl) errors.push("base_url is required");
    if (!this.apiKey) errors.push("api_key is required");
    return { valid: errors.length === 0, errors };
  }

  async *loadFromState(): AsyncGenerator<ConnectorDocument[] | ConnectorFailure> {
    let page = 1;
    let hasMore = true;
    while (hasMore) {
      try {
        const data = await this.xfApi(`/api/threads?page=${page}`);
        const threads = (data.threads ?? []) as Array<Record<string, unknown>>;
        if (threads.length === 0) break;

        const docs: ConnectorDocument[] = threads.map((t) => ({
          id: `xenforo:thread:${t.thread_id}`, source: DocumentSource.XENFORO, title: (t.title as string) ?? "",
          sourceUrl: `${this.baseUrl}/threads/${t.thread_id}`,
          sections: [{ type: SectionType.TEXT as const, content: (t.first_post as Record<string, unknown>)?.message as string ?? "" }],
          metadata: { type: "thread", forumId: t.node_id, replyCount: t.reply_count, viewCount: t.view_count },
          lastModifiedEpochSecs: t.last_post_date ? Number(t.last_post_date) : undefined,
          owners: t.username ? [{ name: t.username as string }] : undefined,
        }));
        if (docs.length > 0) yield docs;
        hasMore = !!(data.pagination as Record<string, unknown>)?.last_page && page < Number((data.pagination as Record<string, unknown>).last_page);
        page++;
      } catch (err) { yield { error: `XenForo fetch failed: ${(err as Error).message}` }; break; }
    }
  }

  private async xfApi(path: string): Promise<Record<string, unknown>> {
    const resp = await fetch(`${this.baseUrl}${path}`, {
      headers: { "XF-Api-Key": this.apiKey, Accept: "application/json" },
    });
    if (!resp.ok) throw new Error(`XenForo API error: ${resp.status}`);
    return resp.json() as Promise<Record<string, unknown>>;
  }
}
