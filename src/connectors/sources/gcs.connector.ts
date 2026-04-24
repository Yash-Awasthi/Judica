/**
 * Google Cloud Storage (GCS) Connector — loads objects from GCS buckets.
 * Supports: LoadConnector, PollConnector.
 */
import type { BaseConnectorConfig, LoadConnector, PollConnector } from "../interfaces.js";
import type { ConnectorDocument, ConnectorFailure } from "../models.js";
import { DocumentSource, SectionType } from "../models.js";

export class GCSConnector implements LoadConnector, PollConnector {
  readonly displayName = "Google Cloud Storage";
  readonly sourceType = DocumentSource.GCS;
  private config!: BaseConnectorConfig;
  private accessToken!: string;
  private bucket!: string;
  private prefix = "";

  async init(config: BaseConnectorConfig): Promise<void> {
    this.config = config;
    this.bucket = config.settings.bucket as string;
    this.prefix = (config.settings.prefix as string) ?? "";
  }
  async loadCredentials(credentials: Record<string, unknown>): Promise<void> { this.accessToken = credentials.access_token as string; }
  async validateSettings(): Promise<{ valid: boolean; errors: string[] }> {
    const errors: string[] = [];
    if (!this.accessToken) errors.push("access_token is required");
    if (!this.bucket) errors.push("bucket is required");
    return { valid: errors.length === 0, errors };
  }

  async *loadFromState(): AsyncGenerator<ConnectorDocument[] | ConnectorFailure> { yield* this.listObjects(); }
  async *pollSource(startEpochSecs: number): AsyncGenerator<ConnectorDocument[] | ConnectorFailure> { yield* this.listObjects(startEpochSecs); }

  private async *listObjects(sinceEpoch?: number): AsyncGenerator<ConnectorDocument[] | ConnectorFailure> {
    let pageToken: string | undefined;
    do {
      try {
        const params = new URLSearchParams({ maxResults: "1000" });
        if (this.prefix) params.set("prefix", this.prefix);
        if (pageToken) params.set("pageToken", pageToken);
        const resp = await fetch(`https://storage.googleapis.com/storage/v1/b/${this.bucket}/o?${params}`, {
          headers: { Authorization: `Bearer ${this.accessToken}` },
        });
        if (!resp.ok) throw new Error(`GCS API error: ${resp.status}`);
        const data = (await resp.json()) as Record<string, unknown>;
        const items = (data.items ?? []) as Array<Record<string, unknown>>;

        const docs: ConnectorDocument[] = [];
        for (const obj of items) {
          if (sinceEpoch && obj.updated) {
            if (Math.floor(new Date(obj.updated as string).getTime() / 1000) < sinceEpoch) continue;
          }
          docs.push({
            id: `gcs:${this.bucket}:${obj.name}`, source: DocumentSource.GCS, title: (obj.name as string).split("/").pop() ?? (obj.name as string),
            sourceUrl: `https://storage.cloud.google.com/${this.bucket}/${obj.name}`,
            sections: [{ type: SectionType.TEXT as const, content: `GCS Object: ${obj.name}\nBucket: ${this.bucket}\nSize: ${obj.size} bytes\nContent-Type: ${obj.contentType}` }],
            metadata: { type: "gcs_object", bucket: this.bucket, key: obj.name, size: Number(obj.size), contentType: obj.contentType },
            lastModifiedEpochSecs: obj.updated ? Math.floor(new Date(obj.updated as string).getTime() / 1000) : undefined,
          });
        }
        if (docs.length > 0) yield docs;
        pageToken = data.nextPageToken as string | undefined;
      } catch (err) { yield { error: `GCS fetch failed: ${(err as Error).message}` }; break; }
    } while (pageToken);
  }
}
