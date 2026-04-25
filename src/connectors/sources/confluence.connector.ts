/**
 * Confluence Connector — loads pages from Atlassian Confluence.
 * Supports: LoadConnector (full sync), PollConnector (incremental).
 */

import type { BaseConnectorConfig, LoadConnector, PollConnector } from "../interfaces.js";
import type { ConnectorDocument, ConnectorFailure } from "../models.js";
import { DocumentSource, SectionType } from "../models.js";

export class ConfluenceConnector implements LoadConnector, PollConnector {
  readonly displayName = "Confluence";
  readonly sourceType = DocumentSource.CONFLUENCE;

  private config!: BaseConnectorConfig;
  private baseUrl!: string;
  private email!: string;
  private apiToken!: string;
  private spaceKeys: string[] = [];

  async init(config: BaseConnectorConfig): Promise<void> {
    this.config = config;
    this.baseUrl = (config.settings.base_url as string) ?? "";
    this.spaceKeys = (config.settings.space_keys as string[]) ?? [];
  }

  async loadCredentials(credentials: Record<string, unknown>): Promise<void> {
    this.email = credentials.email as string;
    this.apiToken = credentials.api_token as string;
  }

  async validateSettings(): Promise<{ valid: boolean; errors: string[] }> {
    const errors: string[] = [];
    if (!this.baseUrl) errors.push("base_url (Confluence instance URL) is required");
    if (!this.email) errors.push("email is required");
    if (!this.apiToken) errors.push("api_token is required");
    return { valid: errors.length === 0, errors };
  }

  async *loadFromState(): AsyncGenerator<ConnectorDocument[] | ConnectorFailure> {
    const spaces = this.spaceKeys.length > 0
      ? this.spaceKeys
      : await this.listAllSpaces();

    for (const spaceKey of spaces) {
      yield* this.fetchSpacePages(spaceKey);
    }
  }

  async *pollSource(
    startEpochSecs: number,
    _endEpochSecs: number,
  ): AsyncGenerator<ConnectorDocument[] | ConnectorFailure> {
    const since = new Date(startEpochSecs * 1000).toISOString().split(".")[0] + "+00:00";
    const spaces = this.spaceKeys.length > 0
      ? this.spaceKeys
      : await this.listAllSpaces();

    for (const spaceKey of spaces) {
      yield* this.fetchSpacePages(spaceKey, since);
    }
  }

  private async listAllSpaces(): Promise<string[]> {
    const resp = await this.confluenceApi("/wiki/api/v2/spaces", { limit: "100" });
    if (!resp.results) return [];
    return (resp.results as Array<{ key: string }>).map((s) => s.key);
  }

  private async *fetchSpacePages(
    spaceKey: string,
    lastModifiedAfter?: string,
  ): AsyncGenerator<ConnectorDocument[] | ConnectorFailure> {
    let startAt = 0;
    const limit = 50;
    let hasMore = true;

    while (hasMore) {
      let cql = `space="${spaceKey}" AND type=page`;
      if (lastModifiedAfter) {
        cql += ` AND lastmodified>="${lastModifiedAfter}"`;
      }

      const resp = await this.confluenceApi("/wiki/rest/api/content/search", {
        cql,
        limit: String(limit),
        start: String(startAt),
        expand: "body.storage,version,space,ancestors",
      });

      if (!resp.results || !Array.isArray(resp.results)) {
        yield { error: `Confluence search failed for space ${spaceKey}` };
        return;
      }

      const pages = resp.results as Array<{
        id: string;
        title: string;
        body?: { storage?: { value?: string } };
        version?: { when?: string; by?: { email?: string; displayName?: string } };
        _links?: { webui?: string };
        space?: { key?: string; name?: string };
      }>;

      const docs: ConnectorDocument[] = pages.map((page) => {
        const htmlContent = page.body?.storage?.value ?? "";
        const textContent = this.stripHtml(htmlContent);

        return {
          id: `confluence:${spaceKey}:${page.id}`,
          source: DocumentSource.CONFLUENCE,
          title: page.title,
          sourceUrl: page._links?.webui
            ? `${this.baseUrl}/wiki${page._links.webui}`
            : undefined,
          sections: [{
            type: SectionType.TEXT as const,
            content: textContent,
            link: page._links?.webui
              ? `${this.baseUrl}/wiki${page._links.webui}`
              : undefined,
          }],
          metadata: {
            spaceKey,
            spaceName: page.space?.name,
            confluenceId: page.id,
          },
          lastModifiedEpochSecs: page.version?.when
            ? Math.floor(new Date(page.version.when).getTime() / 1000)
            : undefined,
          owners: page.version?.by
            ? [{ email: page.version.by.email, name: page.version.by.displayName }]
            : undefined,
        };
      });

      if (docs.length > 0) yield docs;

      hasMore = pages.length === limit;
      startAt += limit;
    }
  }

  private async confluenceApi(
    path: string,
    params?: Record<string, string>,
  ): Promise<Record<string, unknown>> {
    const url = new URL(`${this.baseUrl}${path}`);
    if (params) {
      for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    }

    const auth = Buffer.from(`${this.email}:${this.apiToken}`).toString("base64");
    const resp = await fetch(url.toString(), {
      headers: {
        Authorization: `Basic ${auth}`,
        Accept: "application/json",
      },
    });

    if (!resp.ok) {
      throw new Error(`Confluence API error: ${resp.status} ${resp.statusText}`);
    }

    return resp.json() as Promise<Record<string, unknown>>;
  }

  private stripHtml(html: string): string {
    // State machine approach — no regex on HTML structure (avoids incomplete sanitization)
    const buf: string[] = [];
    let i = 0;
    const len = html.length;
    const lower = html.toLowerCase();
    while (i < len) {
      if (html[i] !== "<") { buf.push(html[i++]); continue; }
      // Skip entire content of script/style blocks
      let blockClose: string | null = null;
      if (lower.startsWith("<script", i) && (i + 7 >= len || " \t\r\n>/<".includes(lower[i + 7]))) {
        blockClose = "</script>";
      } else if (lower.startsWith("<style", i) && (i + 6 >= len || " \t\r\n>/<".includes(lower[i + 6]))) {
        blockClose = "</style>";
      }
      if (blockClose) {
        const closeIdx = lower.indexOf(blockClose, i);
        i = closeIdx !== -1 ? closeIdx + blockClose.length : len;
      } else {
        buf.push(" ");
        while (i < len && html[i] !== ">") i++;
        if (i < len) i++;
      }
    }
    return buf.join("").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
  }
}
