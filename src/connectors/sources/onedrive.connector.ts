/**
 * OneDrive Connector — loads files from Microsoft OneDrive via Graph API.
 * Supports: LoadConnector.
 *
 * Note: For SharePoint-specific content, see sharepoint.connector.ts.
 * This connector targets personal OneDrive drives.
 */

import type { BaseConnectorConfig, LoadConnector } from "../interfaces.js";
import type { ConnectorDocument, ConnectorFailure } from "../models.js";
import { DocumentSource, SectionType } from "../models.js";

const GRAPH_BASE = "https://graph.microsoft.com/v1.0";

export class OneDriveConnector implements LoadConnector {
  readonly displayName = "OneDrive";
  readonly sourceType = DocumentSource.ONEDRIVE;

  private config!: BaseConnectorConfig;
  private accessToken!: string;
  private driveId?: string;
  private folderId?: string;

  async init(config: BaseConnectorConfig): Promise<void> {
    this.config = config;
    this.driveId = config.settings.drive_id as string | undefined;
    this.folderId = config.settings.folder_id as string | undefined;
  }

  async loadCredentials(credentials: Record<string, unknown>): Promise<void> {
    this.accessToken = credentials.access_token as string;
  }

  async validateSettings(): Promise<{ valid: boolean; errors: string[] }> {
    const errors: string[] = [];
    if (!this.accessToken) errors.push("access_token is required");
    return { valid: errors.length === 0, errors };
  }

  async *loadFromState(): AsyncGenerator<ConnectorDocument[] | ConnectorFailure> {
    // Build root path based on config
    let rootPath: string;
    if (this.driveId && this.folderId) {
      rootPath = `/drives/${this.driveId}/items/${this.folderId}/children`;
    } else if (this.driveId) {
      rootPath = `/drives/${this.driveId}/root/children`;
    } else if (this.folderId) {
      rootPath = `/me/drive/items/${this.folderId}/children`;
    } else {
      rootPath = `/me/drive/root/children`;
    }

    yield* this.fetchItems(rootPath);
  }

  private async *fetchItems(
    path: string,
  ): AsyncGenerator<ConnectorDocument[] | ConnectorFailure> {
    let url: string | null = `${GRAPH_BASE}${path}?$top=100&$select=id,name,webUrl,file,folder,lastModifiedDateTime,size,createdBy`;

    while (url) {
      try {
        const resp = await fetch(url, {
          headers: {
            Authorization: `Bearer ${this.accessToken}`,
            Accept: "application/json",
          },
        });

        if (resp.status === 401 || resp.status === 403) {
          console.warn(`OneDrive API auth error: ${resp.status}`);
          return;
        }
        if (!resp.ok) throw new Error(`OneDrive API error: ${resp.status} ${resp.statusText}`);

        const data = (await resp.json()) as Record<string, unknown>;
        const items = (data.value as Array<Record<string, unknown>>) ?? [];

        if (!Array.isArray(items)) break;

        const fileDocs: ConnectorDocument[] = [];
        const folderPaths: string[] = [];

        for (const item of items) {
          if (item.folder) {
            // Queue folder for recursion
            const itemId = item.id as string;
            const drivePrefix = this.driveId
              ? `/drives/${this.driveId}/items`
              : `/me/drive/items`;
            folderPaths.push(`${drivePrefix}/${itemId}/children`);
          } else if (item.file) {
            // It's a file
            const lastModifiedBy = (item.lastModifiedBy as Record<string, unknown>)?.user as Record<string, unknown> | undefined;

            fileDocs.push({
              id: `onedrive:file:${item.id}`,
              source: DocumentSource.ONEDRIVE,
              title: (item.name ?? "Untitled File") as string,
              sourceUrl: (item.webUrl ?? "") as string,
              sections: [
                {
                  type: SectionType.TEXT as const,
                  content: `File: ${item.name}\nSize: ${item.size} bytes`,
                },
              ],
              metadata: {
                itemId: item.id,
                size: item.size,
                mimeType: (item.file as Record<string, unknown>)?.mimeType,
                type: "file",
              },
              lastModifiedEpochSecs: item.lastModifiedDateTime
                ? Math.floor(new Date(item.lastModifiedDateTime as string).getTime() / 1000)
                : undefined,
              owners: lastModifiedBy?.displayName
                ? [{ name: lastModifiedBy.displayName as string, email: lastModifiedBy.email as string }]
                : undefined,
            });
          }
        }

        if (fileDocs.length > 0) yield fileDocs;

        // Recurse into folders
        for (const folderPath of folderPaths) {
          yield* this.fetchItems(folderPath);
        }

        // Follow @odata.nextLink for pagination
        url = (data["@odata.nextLink"] as string | undefined) ?? null;
      } catch (err) {
        yield { error: `OneDrive items fetch failed: ${(err as Error).message}` };
        break;
      }
    }
  }
}
