/**
 * Discourse Connector — loads topics and posts from Discourse forums.
 * Supports: LoadConnector, PollConnector.
 */
import type { BaseConnectorConfig, LoadConnector, PollConnector } from "../interfaces.js";
import type { ConnectorDocument, ConnectorFailure } from "../models.js";
import { DocumentSource, SectionType } from "../models.js";

export class DiscourseConnector implements LoadConnector, PollConnector {
  readonly displayName = "Discourse";
  readonly sourceType = DocumentSource.DISCOURSE;
  private config!: BaseConnectorConfig;
  private baseUrl!: string;
  private apiKey!: string;
  private apiUsername!: string;

  async init(config: BaseConnectorConfig): Promise<void> {
    this.config = config;
    this.baseUrl = (config.settings.base_url as string)?.replace(/\/$/, "") ?? "";
  }
  async loadCredentials(credentials: Record<string, unknown>): Promise<void> {
    this.apiKey = credentials.api_key as string;
    this.apiUsername = (credentials.api_username as string) ?? "system";
  }
  async validateSettings(): Promise<{ valid: boolean; errors: string[] }> {
    const errors: string[] = [];
    if (!this.baseUrl) errors.push("base_url is required");
    if (!this.apiKey) errors.push("api_key is required");
    return { valid: errors.length === 0, errors };
  }

  async *loadFromState(): AsyncGenerator<ConnectorDocument[] | ConnectorFailure> { yield* this.fetchTopics(); }
  async *pollSource(startEpochSecs: number): AsyncGenerator<ConnectorDocument[] | ConnectorFailure> { yield* this.fetchTopics(startEpochSecs); }

  private async *fetchTopics(sinceEpoch?: number): AsyncGenerator<ConnectorDocument[] | ConnectorFailure> {
    let page = 0;
    let hasMore = true;
    while (hasMore) {
      try {
        const data = await this.dcApi(`/latest.json?page=${page}`);
        const topics = ((data.topic_list as Record<string, unknown>)?.topics ?? []) as Array<Record<string, unknown>>;
        if (topics.length === 0) break;

        const docs: ConnectorDocument[] = [];
        for (const t of topics) {
          if (sinceEpoch && t.last_posted_at) {
            if (Math.floor(new Date(t.last_posted_at as string).getTime() / 1000) < sinceEpoch) continue;
          }
          try {
            const topicData = await this.dcApi(`/t/${t.id}.json`);
            const posts = ((topicData.post_stream as Record<string, unknown>)?.posts ?? []) as Array<Record<string, unknown>>;
            const content = posts.map((p) => (p.cooked as string) ?? "").join("\n\n---\n\n");
            docs.push({
              id: `discourse:${t.id}`, source: DocumentSource.DISCOURSE, title: (t.title as string) ?? "",
              sourceUrl: `${this.baseUrl}/t/${t.slug}/${t.id}`,
              sections: [{ type: SectionType.TEXT as const, content }],
              metadata: { type: "topic", categoryId: t.category_id, postsCount: t.posts_count },
              lastModifiedEpochSecs: t.last_posted_at ? Math.floor(new Date(t.last_posted_at as string).getTime() / 1000) : undefined,
            });
          } catch { /* skip individual topic errors */ }
        }
        if (docs.length > 0) yield docs;
        hasMore = topics.length >= 30;
        page++;
      } catch (err) { yield { error: `Discourse fetch failed: ${(err as Error).message}` }; break; }
    }
  }

  private async dcApi(path: string): Promise<Record<string, unknown>> {
    const resp = await fetch(`${this.baseUrl}${path}`, {
      headers: { "Api-Key": this.apiKey, "Api-Username": this.apiUsername, Accept: "application/json" },
    });
    if (!resp.ok) throw new Error(`Discourse API error: ${resp.status}`);
    return resp.json() as Promise<Record<string, unknown>>;
  }
}
