/**
 * SharePoint Connector — loads documents from SharePoint Online via Microsoft Graph API.
 * Supports: LoadConnector, PollConnector.
 */

import type { BaseConnectorConfig, LoadConnector, PollConnector } from "../interfaces.js";
import type { ConnectorDocument, ConnectorFailure } from "../models.js";
import { DocumentSource, SectionType } from "../models.js";

export class SharePointConnector implements LoadConnector, PollConnector {
  readonly displayName = "SharePoint";
  readonly sourceType = DocumentSource.SHAREPOINT;

  private config!: BaseConnectorConfig;
  private accessToken!: string;
  private siteIds: string[] = [];

  async init(config: BaseConnectorConfig): Promise<void> {
    this.config = config;
    this.siteIds = (config.settings.site_ids as string[]) ?? [];
  }

  async loadCredentials(credentials: Record<string, unknown>): Promise<void> {
    this.accessToken = credentials.access_token as string;
  }

  async validateSettings(): Promise<{ valid: boolean; errors: string[] }> {
    const errors: string[] = [];
    if (!this.accessToken) errors.push("access_token is required");
    if (this.siteIds.length === 0) errors.push("At least one site_id is required");
    return { valid: errors.length === 0, errors };
  }

  async *loadFromState(): AsyncGenerator<ConnectorDocument[] | ConnectorFailure> {
    for (const siteId of this.siteIds) {
      yield* this.fetchSiteDriveItems(siteId);
    }
  }

  async *pollSource(
    startEpochSecs: number,
  ): AsyncGenerator<ConnectorDocument[] | ConnectorFailure> {
    for (const siteId of this.siteIds) {
      yield* this.fetchSiteDriveItems(siteId, startEpochSecs);
    }
  }

  private async *fetchSiteDriveItems(
    siteId: string,
    sinceEpoch?: number,
  ): AsyncGenerator<ConnectorDocument[] | ConnectorFailure> {
    try {
      const drives = await this.graphApi(`/sites/${siteId}/drives`);
      const driveList = (drives.value ?? []) as Array<Record<string, unknown>>;

      for (const drive of driveList) {
        let url: string | null = `/drives/${drive.id}/root/children?$top=200`;
        while (url) {
          const data = await this.graphApi(url);
          const items = (data.value ?? []) as Array<Record<string, unknown>>;
          const docs: ConnectorDocument[] = [];

          for (const item of items) {
            if (item.folder) continue;
            const modified = item.lastModifiedDateTime as string;
            if (sinceEpoch && modified) {
              if (Math.floor(new Date(modified).getTime() / 1000) < sinceEpoch) continue;
            }
            docs.push({
              id: `sharepoint:${siteId}:${item.id}`,
              source: DocumentSource.SHAREPOINT,
              title: (item.name as string) ?? "",
              sourceUrl: item.webUrl as string,
              sections: [{
                type: SectionType.TEXT,
                content: `File: ${item.name}\nSize: ${item.size} bytes\nCreated by: ${((item.createdBy as Record<string, Record<string, string>>)?.user?.displayName) ?? "unknown"}`,
              }],
              metadata: { type: "file", driveId: drive.id, mimeType: (item.file as Record<string, unknown>)?.mimeType },
              lastModifiedEpochSecs: modified ? Math.floor(new Date(modified).getTime() / 1000) : undefined,
            });
          }

          if (docs.length > 0) yield docs;
          url = (data["@odata.nextLink"] as string) ?? null;
          if (url) url = url.replace("https://graph.microsoft.com/v1.0", "");
        }
      }
    } catch (err) {
      yield { error: `SharePoint fetch failed for site ${siteId}: ${(err as Error).message}` };
    }
  }

  private async graphApi(path: string): Promise<Record<string, unknown>> {
    const base = "https://graph.microsoft.com/v1.0";
    const url = path.startsWith("http") ? path : `${base}${path}`;
    const resp = await fetch(url, {
      headers: { Authorization: `Bearer ${this.accessToken}`, Accept: "application/json" },
    });
    if (!resp.ok) throw new Error(`Microsoft Graph API error: ${resp.status} ${resp.statusText}`);
    return resp.json() as Promise<Record<string, unknown>>;
  }
}
