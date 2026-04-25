/**
 * Egnyte Connector — loads files and folders from Egnyte cloud storage.
 * Supports: LoadConnector.
 */

import type { BaseConnectorConfig, LoadConnector } from "../interfaces.js";
import type { ConnectorDocument, ConnectorFailure } from "../models.js";
import { DocumentSource, SectionType } from "../models.js";

export class EgnyteConnector implements LoadConnector {
  readonly displayName = "Egnyte";
  readonly sourceType = DocumentSource.EGNYTE;

  private config!: BaseConnectorConfig;
  private domain!: string;
  private accessToken!: string;
  private rootPath: string = "/";

  async init(config: BaseConnectorConfig): Promise<void> {
    this.config = config;
    this.domain = config.settings.domain as string;
    this.rootPath = (config.settings.path as string) ?? "/";
  }

  async loadCredentials(credentials: Record<string, unknown>): Promise<void> {
    this.accessToken = credentials.access_token as string;
  }

  async validateSettings(): Promise<{ valid: boolean; errors: string[] }> {
    const errors: string[] = [];
    if (!this.domain) errors.push("domain is required");
    if (!this.accessToken) errors.push("access_token is required");
    return { valid: errors.length === 0, errors };
  }

  async *loadFromState(): AsyncGenerator<ConnectorDocument[] | ConnectorFailure> {
    yield* this.traverseFolder(this.rootPath);
  }

  private async *traverseFolder(
    path: string,
  ): AsyncGenerator<ConnectorDocument[] | ConnectorFailure> {
    try {
      const data = (await this.egnyteApi(`/pubapi/v1/fs${path}`)) as Record<string, unknown>;
      const entries = (data.files as Array<Record<string, unknown>>) ?? [];
      const folders = (data.folders as Array<Record<string, unknown>>) ?? [];

      // Process files in this folder
      const docs: ConnectorDocument[] = entries
        .filter((f) => !f.is_folder)
        .map((file) => ({
          id: `egnyte:file:${file.entry_id ?? file.checksum ?? encodeURIComponent(file.path as string)}`,
          source: DocumentSource.EGNYTE,
          title: (file.name ?? file.path) as string,
          sourceUrl: (file.url ?? `https://${this.domain}.egnyte.com/dl/placeholder/${file.entry_id}`) as string,
          sections: [{ type: SectionType.TEXT as const, content: `File: ${file.name}\nPath: ${file.path}\nSize: ${file.size} bytes` }],
          metadata: {
            path: file.path,
            size: file.size,
            contentType: file.content_type,
            entryId: file.entry_id,
            type: "file",
          },
          lastModifiedEpochSecs: file.last_modified
            ? Math.floor(new Date(file.last_modified as string).getTime() / 1000)
            : undefined,
        }));

      if (docs.length > 0) yield docs;

      // Recurse into subfolders
      for (const folder of folders) {
        const folderPath = (folder.path ?? `${path}/${folder.name}`) as string;
        yield* this.traverseFolder(folderPath);
      }
    } catch (err) {
      yield { error: `Egnyte folder traversal failed for ${path}: ${(err as Error).message}` };
    }
  }

  private async egnyteApi(path: string): Promise<unknown> {
    const url = `https://${this.domain}.egnyte.com${path}`;
    const resp = await fetch(url, {
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        Accept: "application/json",
      },
    });
    if (resp.status === 401 || resp.status === 403) {
      console.warn(`Egnyte API auth error: ${resp.status}`);
      return { files: [], folders: [] };
    }
    if (!resp.ok) throw new Error(`Egnyte API error: ${resp.status} ${resp.statusText}`);
    return resp.json();
  }
}
