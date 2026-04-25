/**
 * Drupal Connector — loads content nodes from Drupal CMS via JSON:API.
 * Supports: LoadConnector.
 */

import type { BaseConnectorConfig, LoadConnector } from "../interfaces.js";
import type { ConnectorDocument, ConnectorFailure } from "../models.js";
import { DocumentSource, SectionType } from "../models.js";

export class DrupalConnector implements LoadConnector {
  readonly displayName = "Drupal";
  readonly sourceType = DocumentSource.DRUPAL;

  private config!: BaseConnectorConfig;
  private baseUrl!: string;
  private username!: string;
  private password!: string;
  private contentTypes: string[] = [];

  async init(config: BaseConnectorConfig): Promise<void> {
    this.config = config;
    this.baseUrl = (config.settings.base_url as string)?.replace(/\/$/, "");
    this.contentTypes = (config.settings.content_types as string[]) ?? ["article", "page"];
  }

  async loadCredentials(credentials: Record<string, unknown>): Promise<void> {
    this.username = credentials.username as string;
    this.password = credentials.password as string;
  }

  async validateSettings(): Promise<{ valid: boolean; errors: string[] }> {
    const errors: string[] = [];
    if (!this.baseUrl) errors.push("base_url is required");
    if (!this.username) errors.push("username is required");
    if (!this.password) errors.push("password is required");
    return { valid: errors.length === 0, errors };
  }

  async *loadFromState(): AsyncGenerator<ConnectorDocument[] | ConnectorFailure> {
    for (const contentType of this.contentTypes) {
      yield* this.fetchContentType(contentType);
    }
  }

  private async *fetchContentType(
    contentType: string,
  ): AsyncGenerator<ConnectorDocument[] | ConnectorFailure> {
    let url: string | null = `${this.baseUrl}/jsonapi/node/${contentType}?page[limit]=50`;

    while (url) {
      try {
        const resp = await fetch(url, {
          headers: {
            Accept: "application/vnd.api+json",
            Authorization: `Basic ${Buffer.from(`${this.username}:${this.password}`).toString("base64")}`,
          },
        });

        if (resp.status === 401 || resp.status === 403) {
          console.warn(`Drupal API auth error: ${resp.status}`);
          return;
        }
        if (!resp.ok) throw new Error(`Drupal API error: ${resp.status} ${resp.statusText}`);

        const data = (await resp.json()) as Record<string, unknown>;
        const nodes = (data.data as Array<Record<string, unknown>>) ?? [];

        const docs: ConnectorDocument[] = nodes.map((node) => {
          const attrs = (node.attributes ?? {}) as Record<string, unknown>;
          const body = attrs.body as Record<string, unknown> | undefined;
          const content = (body?.value ?? body?.processed ?? attrs.field_body ?? "") as string;
          const links = node.links as Record<string, unknown> | undefined;
          const selfUrl = (links?.self as Record<string, unknown>)?.href as string | undefined;

          return {
            id: `drupal:${contentType}:${node.id}`,
            source: DocumentSource.DRUPAL,
            title: (attrs.title as string) ?? "Untitled",
            sourceUrl: selfUrl ?? `${this.baseUrl}/node/${attrs.drupal_internal__nid}`,
            sections: [{ type: SectionType.TEXT as const, content: stripHtml(content) }],
            metadata: {
              contentType,
              nodeId: node.id,
              status: attrs.status,
            },
            lastModifiedEpochSecs: attrs.changed
              ? Math.floor(new Date(attrs.changed as string).getTime() / 1000)
              : undefined,
          };
        });

        if (docs.length > 0) yield docs;

        // Follow next link for pagination
        const links = data.links as Record<string, unknown> | undefined;
        const nextLink = links?.next as Record<string, unknown> | string | undefined;
        url = typeof nextLink === "string" ? nextLink : (nextLink?.href as string | undefined) ?? null;
      } catch (err) {
        yield { error: `Drupal fetch failed for ${contentType}: ${(err as Error).message}` };
        break;
      }
    }
  }
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}
