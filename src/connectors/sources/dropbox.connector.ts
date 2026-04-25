/**
 * Dropbox Connector — loads files and folders from Dropbox.
 * Supports: LoadConnector, PollConnector.
 */

import type { BaseConnectorConfig, LoadConnector, PollConnector } from "../interfaces.js";
import type { ConnectorDocument, ConnectorFailure } from "../models.js";
import { DocumentSource, SectionType } from "../models.js";

export class DropboxConnector implements LoadConnector, PollConnector {
  readonly displayName = "Dropbox";
  readonly sourceType = DocumentSource.DROPBOX;

  private config!: BaseConnectorConfig;
  private accessToken!: string;
  private folderPaths: string[] = [];

  async init(config: BaseConnectorConfig): Promise<void> {
    this.config = config;
    this.folderPaths = (config.settings.folder_paths as string[]) ?? [""];
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
    for (const folder of this.folderPaths) {
      yield* this.listFolder(folder);
    }
  }

  async *pollSource(
    startEpochSecs: number,
  ): AsyncGenerator<ConnectorDocument[] | ConnectorFailure> {
    for (const folder of this.folderPaths) {
      yield* this.listFolder(folder, startEpochSecs);
    }
  }

  private async *listFolder(
    path: string,
    sinceEpoch?: number,
  ): AsyncGenerator<ConnectorDocument[] | ConnectorFailure> {
    let cursor: string | undefined;
    let hasMore = true;

    while (hasMore) {
      try {
        const body = cursor
          ? { cursor }
          : { path: path || "", recursive: true, limit: 200 };
        const endpoint = cursor
          ? "https://api.dropboxapi.com/2/files/list_folder/continue"
          : "https://api.dropboxapi.com/2/files/list_folder";

        const resp = await fetch(endpoint, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${this.accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
        });
        if (!resp.ok) throw new Error(`Dropbox API error: ${resp.status}`);
        const data = (await resp.json()) as Record<string, unknown>;

        const entries = (data.entries ?? []) as Array<Record<string, unknown>>;
        const docs: ConnectorDocument[] = [];

        for (const entry of entries) {
          if (entry[".tag"] !== "file") continue;
          const modifiedAt = entry.server_modified as string;
          if (sinceEpoch && modifiedAt) {
            const entryEpoch = Math.floor(new Date(modifiedAt).getTime() / 1000);
            if (entryEpoch < sinceEpoch) continue;
          }
          docs.push({
            id: `dropbox:${entry.id}`,
            source: DocumentSource.DROPBOX,
            title: (entry.name as string) ?? "",
            sourceUrl: `https://www.dropbox.com/home${entry.path_display}`,
            sections: [{
              type: SectionType.TEXT,
              content: `File: ${entry.name}\nPath: ${entry.path_display}\nSize: ${entry.size} bytes`,
            }],
            metadata: { type: "file", path: entry.path_display, size: entry.size },
            lastModifiedEpochSecs: modifiedAt ? Math.floor(new Date(modifiedAt).getTime() / 1000) : undefined,
          });
        }

        if (docs.length > 0) yield docs;
        hasMore = data.has_more as boolean;
        cursor = data.cursor as string;
      } catch (err) {
        yield { error: `Dropbox list folder failed: ${(err as Error).message}` };
        break;
      }
    }
  }
}
