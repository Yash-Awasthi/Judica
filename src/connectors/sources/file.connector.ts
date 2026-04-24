/**
 * File Connector — processes uploaded files using existing file processors.
 * Bridges the connector system to the existing processors/ directory.
 * Supports: LoadConnector (process a batch of files).
 */

import type { BaseConnectorConfig, LoadConnector } from "../interfaces.js";
import type { ConnectorDocument, ConnectorFailure } from "../models.js";
import { DocumentSource, SectionType } from "../models.js";
import { processFile } from "../../processors/index.js";

export class FileConnector implements LoadConnector {
  readonly displayName = "File Upload";
  readonly sourceType = DocumentSource.FILE;

  private config!: BaseConnectorConfig;
  private filePaths: string[] = [];

  async init(config: BaseConnectorConfig): Promise<void> {
    this.config = config;
    this.filePaths = (config.settings.file_paths as string[]) ?? [];
  }

  async loadCredentials(_credentials: Record<string, unknown>): Promise<void> {
    // File connector doesn't need credentials
  }

  async validateSettings(): Promise<{ valid: boolean; errors: string[] }> {
    const errors: string[] = [];
    if (this.filePaths.length === 0) errors.push("At least one file_path is required");
    return { valid: errors.length === 0, errors };
  }

  async *loadFromState(): AsyncGenerator<ConnectorDocument[] | ConnectorFailure> {
    for (const filePath of this.filePaths) {
      try {
        const filename = filePath.split("/").pop() ?? filePath;
        const result = await processFile({
          id: `file-connector-${filePath}`,
          mimeType: this.guessMimeType(filePath),
          storagePath: filePath,
          originalName: filename,
        });

        if (result.text) {
          yield [{
            id: `file:${filePath}`,
            source: DocumentSource.FILE,
            title: filePath.split("/").pop() ?? filePath,
            sections: [{ type: SectionType.TEXT, content: result.text }],
            metadata: {
              filePath,
              mimeType: result.mimeType,
              ...result.metadata,
            },
          }];
        }
      } catch (err) {
        yield {
          error: `Failed to process file ${filePath}: ${(err as Error).message}`,
          failedDocId: filePath,
        };
      }
    }
  }

  private guessMimeType(filePath: string): string {
    const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
    const mimeMap: Record<string, string> = {
      pdf: "application/pdf",
      docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      csv: "text/csv",
      txt: "text/plain",
      png: "image/png",
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      mp3: "audio/mpeg",
      wav: "audio/wav",
    };
    return mimeMap[ext] ?? "application/octet-stream";
  }
}
