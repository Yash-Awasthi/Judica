/**
 * Axero (Communifire) Connector — loads articles, wiki pages, and forum posts
 * from Axero intranet/social platform.
 * Supports: LoadConnector.
 */

import type { BaseConnectorConfig, LoadConnector } from "../interfaces.js";
import type { ConnectorDocument, ConnectorFailure } from "../models.js";
import { DocumentSource, SectionType } from "../models.js";

export class AxeroConnector implements LoadConnector {
  readonly displayName = "Axero";
  readonly sourceType = DocumentSource.AXERO;

  private config!: BaseConnectorConfig;
  private baseUrl!: string;
  private apiKey!: string;
  private communityId?: string;

  async init(config: BaseConnectorConfig): Promise<void> {
    this.config = config;
    this.baseUrl = (config.settings.base_url as string)?.replace(/\/$/, "");
    this.communityId = config.settings.community_id as string | undefined;
  }

  async loadCredentials(credentials: Record<string, unknown>): Promise<void> {
    this.apiKey = credentials.api_key as string;
  }

  async validateSettings(): Promise<{ valid: boolean; errors: string[] }> {
    const errors: string[] = [];
    if (!this.baseUrl) errors.push("base_url is required");
    if (!this.apiKey) errors.push("api_key is required");
    return { valid: errors.length === 0, errors };
  }

  async *loadFromState(): AsyncGenerator<ConnectorDocument[] | ConnectorFailure> {
    yield* this.fetchArticles();
    yield* this.fetchWikiPages();
    yield* this.fetchForumPosts();
  }

  private async *fetchArticles(): AsyncGenerator<ConnectorDocument[] | ConnectorFailure> {
    let pageIndex = 1;
    let hasMore = true;

    while (hasMore) {
      try {
        const params: Record<string, string> = {
          pageIndex: String(pageIndex),
          pageSize: "50",
        };
        if (this.communityId) params.spaceId = this.communityId;

        const data = (await this.axeroApi("/api2/article/list", params)) as Record<string, unknown>;
        const articles = (data.data as Array<Record<string, unknown>>) ?? (data.Data as Array<Record<string, unknown>>) ?? [];

        if (!Array.isArray(articles) || articles.length === 0) break;

        const docs: ConnectorDocument[] = articles.map((article) => ({
          id: `axero:article:${article.ID ?? article.Id ?? article.id}`,
          source: DocumentSource.AXERO,
          title: (article.Title ?? article.title ?? "Untitled") as string,
          sourceUrl: (article.Url ?? article.ArticleUrl ?? `${this.baseUrl}/article/${article.ID}`) as string,
          sections: [
            {
              type: SectionType.TEXT as const,
              content: stripHtml((article.Body ?? article.Content ?? article.body ?? "") as string),
            },
          ],
          metadata: { type: "article", communityId: article.SpaceID },
          lastModifiedEpochSecs: article.DateModified ?? article.ModifiedDate
            ? Math.floor(new Date((article.DateModified ?? article.ModifiedDate) as string).getTime() / 1000)
            : undefined,
        }));

        if (docs.length > 0) yield docs;
        hasMore = articles.length === 50;
        pageIndex++;
      } catch (err) {
        yield { error: `Axero articles fetch failed: ${(err as Error).message}` };
        break;
      }
    }
  }

  private async *fetchWikiPages(): AsyncGenerator<ConnectorDocument[] | ConnectorFailure> {
    let pageIndex = 1;
    let hasMore = true;

    while (hasMore) {
      try {
        const params: Record<string, string> = {
          pageIndex: String(pageIndex),
          pageSize: "50",
        };
        if (this.communityId) params.spaceId = this.communityId;

        const data = (await this.axeroApi("/api2/wiki/list", params)) as Record<string, unknown>;
        const pages = (data.data as Array<Record<string, unknown>>) ?? (data.Data as Array<Record<string, unknown>>) ?? [];

        if (!Array.isArray(pages) || pages.length === 0) break;

        const docs: ConnectorDocument[] = pages.map((page) => ({
          id: `axero:wiki:${page.ID ?? page.Id ?? page.id}`,
          source: DocumentSource.AXERO,
          title: (page.Title ?? page.title ?? "Untitled") as string,
          sourceUrl: (page.Url ?? `${this.baseUrl}/wiki/${page.ID}`) as string,
          sections: [
            {
              type: SectionType.TEXT as const,
              content: stripHtml((page.Body ?? page.Content ?? page.body ?? "") as string),
            },
          ],
          metadata: { type: "wiki_page", communityId: page.SpaceID },
          lastModifiedEpochSecs: page.DateModified
            ? Math.floor(new Date(page.DateModified as string).getTime() / 1000)
            : undefined,
        }));

        if (docs.length > 0) yield docs;
        hasMore = pages.length === 50;
        pageIndex++;
      } catch (err) {
        yield { error: `Axero wiki fetch failed: ${(err as Error).message}` };
        break;
      }
    }
  }

  private async *fetchForumPosts(): AsyncGenerator<ConnectorDocument[] | ConnectorFailure> {
    let pageIndex = 1;
    let hasMore = true;

    while (hasMore) {
      try {
        const params: Record<string, string> = {
          pageIndex: String(pageIndex),
          pageSize: "50",
        };
        if (this.communityId) params.spaceId = this.communityId;

        const data = (await this.axeroApi("/api2/forum/list", params)) as Record<string, unknown>;
        const posts = (data.data as Array<Record<string, unknown>>) ?? (data.Data as Array<Record<string, unknown>>) ?? [];

        if (!Array.isArray(posts) || posts.length === 0) break;

        const docs: ConnectorDocument[] = posts.map((post) => ({
          id: `axero:forum:${post.ID ?? post.Id ?? post.id}`,
          source: DocumentSource.AXERO,
          title: (post.Title ?? post.Subject ?? post.title ?? "Untitled Post") as string,
          sourceUrl: (post.Url ?? `${this.baseUrl}/forum/${post.ID}`) as string,
          sections: [
            {
              type: SectionType.TEXT as const,
              content: stripHtml((post.Body ?? post.Content ?? post.body ?? "") as string),
            },
          ],
          metadata: { type: "forum_post", communityId: post.SpaceID },
          lastModifiedEpochSecs: post.DateModified ?? post.LastActivityDate
            ? Math.floor(new Date((post.DateModified ?? post.LastActivityDate) as string).getTime() / 1000)
            : undefined,
        }));

        if (docs.length > 0) yield docs;
        hasMore = posts.length === 50;
        pageIndex++;
      } catch (err) {
        yield { error: `Axero forum fetch failed: ${(err as Error).message}` };
        break;
      }
    }
  }

  private async axeroApi(path: string, params?: Record<string, string>): Promise<unknown> {
    const url = new URL(`${this.baseUrl}${path}`);
    if (params) for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    const resp = await fetch(url.toString(), {
      headers: {
        ApiKey: this.apiKey,
        Accept: "application/json",
      },
    });
    if (resp.status === 401 || resp.status === 403) {
      console.warn(`Axero API auth error: ${resp.status}`);
      return { data: [] };
    }
    if (!resp.ok) throw new Error(`Axero API error: ${resp.status} ${resp.statusText}`);
    return resp.json();
  }
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}
