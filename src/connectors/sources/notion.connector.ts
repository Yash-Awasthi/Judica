/**
 * Notion Connector — loads pages from a Notion workspace.
 * Supports: LoadConnector (full sync), PollConnector (incremental).
 */

import type { BaseConnectorConfig, LoadConnector, PollConnector } from "../interfaces.js";
import type { ConnectorDocument, ConnectorFailure } from "../models.js";
import { DocumentSource, SectionType } from "../models.js";

export class NotionConnector implements LoadConnector, PollConnector {
  readonly displayName = "Notion";
  readonly sourceType = DocumentSource.NOTION;

  private config!: BaseConnectorConfig;
  private apiKey!: string;
  private rootPageIds: string[] = [];

  async init(config: BaseConnectorConfig): Promise<void> {
    this.config = config;
    this.rootPageIds = (config.settings.root_page_ids as string[]) ?? [];
  }

  async loadCredentials(credentials: Record<string, unknown>): Promise<void> {
    this.apiKey = credentials.api_key as string;
  }

  async validateSettings(): Promise<{ valid: boolean; errors: string[] }> {
    const errors: string[] = [];
    if (!this.apiKey) errors.push("api_key (Notion integration token) is required");
    return { valid: errors.length === 0, errors };
  }

  async *loadFromState(): AsyncGenerator<ConnectorDocument[] | ConnectorFailure> {
    let cursor: string | undefined;
    do {
      const result = await this.searchPages(undefined, cursor);
      if (result.error) {
        yield { error: result.error };
        return;
      }
      if (result.docs.length > 0) yield result.docs;
      cursor = result.nextCursor;
    } while (cursor);
  }

  async *pollSource(
    startEpochSecs: number,
    _endEpochSecs: number,
  ): AsyncGenerator<ConnectorDocument[] | ConnectorFailure> {
    const startTime = new Date(startEpochSecs * 1000).toISOString();
    let cursor: string | undefined;
    do {
      const result = await this.searchPages(startTime, cursor);
      if (result.error) {
        yield { error: result.error };
        return;
      }
      if (result.docs.length > 0) yield result.docs;
      cursor = result.nextCursor;
    } while (cursor);
  }

  private async searchPages(
    lastEditedAfter?: string,
    startCursor?: string,
  ): Promise<{ docs: ConnectorDocument[]; nextCursor?: string; error?: string }> {
    const body: Record<string, unknown> = {
      filter: { property: "object", value: "page" },
      page_size: 100,
    };
    if (lastEditedAfter) {
      body.sort = { direction: "descending", timestamp: "last_edited_time" };
    }
    if (startCursor) body.start_cursor = startCursor;

    const resp = await fetch("https://api.notion.com/v1/search", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Notion-Version": "2022-06-28",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      return { docs: [], error: `Notion API error: ${resp.status} ${resp.statusText}` };
    }

    const data = (await resp.json()) as {
      results: Array<{
        id: string;
        url: string;
        last_edited_time: string;
        properties: Record<string, unknown>;
        created_by?: { id: string };
      }>;
      has_more: boolean;
      next_cursor?: string;
    };

    // If filtering by time, skip pages not modified after the threshold
    const filteredResults = lastEditedAfter
      ? data.results.filter((p) => p.last_edited_time >= lastEditedAfter)
      : data.results;

    const docs: ConnectorDocument[] = [];
    for (const page of filteredResults) {
      const content = await this.getPageContent(page.id);
      const title = this.extractTitle(page.properties);

      docs.push({
        id: `notion:${page.id}`,
        source: DocumentSource.NOTION,
        title: title ?? "Untitled",
        sourceUrl: page.url,
        sections: [{ type: SectionType.TEXT, content, link: page.url }],
        metadata: { notionId: page.id },
        lastModifiedEpochSecs: Math.floor(
          new Date(page.last_edited_time).getTime() / 1000,
        ),
      });
    }

    return {
      docs,
      nextCursor: data.has_more ? data.next_cursor : undefined,
    };
  }

  private async getPageContent(pageId: string): Promise<string> {
    const resp = await fetch(
      `https://api.notion.com/v1/blocks/${pageId}/children?page_size=100`,
      {
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Notion-Version": "2022-06-28",
        },
      },
    );

    if (!resp.ok) return "";

    const data = (await resp.json()) as {
      results: Array<{
        type: string;
        [key: string]: unknown;
      }>;
    };

    return data.results
      .map((block) => this.blockToText(block))
      .filter(Boolean)
      .join("\n\n");
  }

  private blockToText(block: Record<string, unknown>): string {
    const type = block.type as string;
    const content = block[type] as Record<string, unknown> | undefined;
    if (!content) return "";

    const richText = content.rich_text as Array<{ plain_text: string }> | undefined;
    if (richText) {
      return richText.map((t) => t.plain_text).join("");
    }
    return "";
  }

  private extractTitle(properties: Record<string, unknown>): string | undefined {
    for (const prop of Object.values(properties)) {
      const p = prop as Record<string, unknown>;
      if (p.type === "title") {
        const titleArr = p.title as Array<{ plain_text: string }> | undefined;
        if (titleArr && titleArr.length > 0) {
          return titleArr.map((t) => t.plain_text).join("");
        }
      }
    }
    return undefined;
  }
}
