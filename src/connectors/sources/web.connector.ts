/**
 * Web Connector — crawls web pages and extracts text content.
 * Supports: LoadConnector (one-shot crawl of provided URLs).
 */

import type { BaseConnectorConfig, LoadConnector } from "../interfaces.js";
import type { ConnectorDocument, ConnectorFailure } from "../models.js";
import { DocumentSource, SectionType } from "../models.js";

export class WebConnector implements LoadConnector {
  readonly displayName = "Web";
  readonly sourceType = DocumentSource.WEB;

  private config!: BaseConnectorConfig;
  private urls: string[] = [];
  private maxDepth = 0;

  async init(config: BaseConnectorConfig): Promise<void> {
    this.config = config;
    this.urls = (config.settings.urls as string[]) ?? [];
    this.maxDepth = (config.settings.max_depth as number) ?? 0;
  }

  async loadCredentials(_credentials: Record<string, unknown>): Promise<void> {
    // Web connector doesn't need credentials
  }

  async validateSettings(): Promise<{ valid: boolean; errors: string[] }> {
    const errors: string[] = [];
    if (this.urls.length === 0) errors.push("At least one URL is required");
    for (const url of this.urls) {
      try {
        new URL(url);
      } catch {
        errors.push(`Invalid URL: ${url}`);
      }
    }
    return { valid: errors.length === 0, errors };
  }

  async *loadFromState(): AsyncGenerator<ConnectorDocument[] | ConnectorFailure> {
    for (const url of this.urls) {
      try {
        const resp = await fetch(url, {
          headers: { "User-Agent": "JUDICA-Connector/1.0" },
          signal: AbortSignal.timeout(30_000),
        });

        if (!resp.ok) {
          yield { error: `Failed to fetch ${url}: ${resp.status}` };
          continue;
        }

        const html = await resp.text();
        const text = this.extractText(html);
        const title = this.extractTitle(html) ?? url;

        yield [{
          id: `web:${url}`,
          source: DocumentSource.WEB,
          title,
          sourceUrl: url,
          sections: [{ type: SectionType.TEXT, content: text, link: url }],
          metadata: {
            contentType: resp.headers.get("content-type"),
            fetchedAt: new Date().toISOString(),
          },
        }];
      } catch (err) {
        yield { error: `Error crawling ${url}: ${(err as Error).message}` };
      }
    }
  }

  private extractTitle(html: string): string | undefined {
    const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    return match?.[1]?.trim();
  }

  private extractText(html: string): string {
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
