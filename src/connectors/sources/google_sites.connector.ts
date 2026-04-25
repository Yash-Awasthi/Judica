/**
 * Google Sites Connector — loads pages from Google Sites via Google Drive API.
 * Supports: LoadConnector.
 */
import type { BaseConnectorConfig, LoadConnector } from "../interfaces.js";
import type { ConnectorDocument, ConnectorFailure } from "../models.js";
import { DocumentSource, SectionType } from "../models.js";

export class GoogleSitesConnector implements LoadConnector {
  readonly displayName = "Google Sites";
  readonly sourceType = DocumentSource.GOOGLE_SITES;
  private config!: BaseConnectorConfig;
  private accessToken!: string;
  private siteUrls: string[] = [];

  async init(config: BaseConnectorConfig): Promise<void> {
    this.config = config;
    this.siteUrls = (config.settings.site_urls as string[]) ?? [];
  }
  async loadCredentials(credentials: Record<string, unknown>): Promise<void> { this.accessToken = credentials.access_token as string; }
  async validateSettings(): Promise<{ valid: boolean; errors: string[] }> {
    const errors: string[] = [];
    if (!this.accessToken) errors.push("access_token is required");
    if (this.siteUrls.length === 0) errors.push("At least one site_url is required");
    return { valid: errors.length === 0, errors };
  }

  async *loadFromState(): AsyncGenerator<ConnectorDocument[] | ConnectorFailure> {
    // Google Sites doesn't have a direct API — we query via Google Drive for Site files
    try {
      const query = "mimeType='application/vnd.google-apps.site'";
      const resp = await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&fields=files(id,name,webViewLink,modifiedTime)`, {
        headers: { Authorization: `Bearer ${this.accessToken}` },
      });
      if (!resp.ok) throw new Error(`Google Drive API error: ${resp.status}`);
      const data = (await resp.json()) as Record<string, unknown>;
      const files = (data.files ?? []) as Array<Record<string, unknown>>;
      const docs: ConnectorDocument[] = files.map((f) => ({
        id: `google_sites:${f.id}`, source: DocumentSource.GOOGLE_SITES, title: (f.name as string) ?? "",
        sourceUrl: f.webViewLink as string,
        sections: [{ type: SectionType.TEXT as const, content: `Google Site: ${f.name}` }],
        metadata: { type: "site" },
        lastModifiedEpochSecs: f.modifiedTime ? Math.floor(new Date(f.modifiedTime as string).getTime() / 1000) : undefined,
      }));
      if (docs.length > 0) yield docs;
    } catch (err) { yield { error: `Google Sites fetch failed: ${(err as Error).message}` }; }
  }
}
