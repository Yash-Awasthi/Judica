/**
 * Cloudflare R2 Connector — loads objects from R2 buckets via S3-compatible API.
 * Supports: LoadConnector.
 */
import type { BaseConnectorConfig, LoadConnector } from "../interfaces.js";
import type { ConnectorDocument, ConnectorFailure } from "../models.js";
import { DocumentSource, SectionType } from "../models.js";

export class R2Connector implements LoadConnector {
  readonly displayName = "Cloudflare R2";
  readonly sourceType = DocumentSource.R2;
  private config!: BaseConnectorConfig;
  private accountId!: string;
  private accessKeyId!: string;
  private secretAccessKey!: string;
  private bucket!: string;
  private prefix = "";

  async init(config: BaseConnectorConfig): Promise<void> {
    this.config = config;
    this.bucket = config.settings.bucket as string;
    this.prefix = (config.settings.prefix as string) ?? "";
    this.accountId = config.settings.account_id as string;
  }
  async loadCredentials(credentials: Record<string, unknown>): Promise<void> {
    this.accessKeyId = credentials.access_key_id as string;
    this.secretAccessKey = credentials.secret_access_key as string;
  }
  async validateSettings(): Promise<{ valid: boolean; errors: string[] }> {
    const errors: string[] = [];
    if (!this.bucket) errors.push("bucket is required");
    if (!this.accountId) errors.push("account_id is required");
    if (!this.accessKeyId || !this.secretAccessKey) errors.push("access_key_id and secret_access_key are required");
    return { valid: errors.length === 0, errors };
  }

  async *loadFromState(): AsyncGenerator<ConnectorDocument[] | ConnectorFailure> {
    try {
      // R2 uses S3-compatible API
      const endpoint = `https://${this.accountId}.r2.cloudflarestorage.com`;
      const url = `${endpoint}/${this.bucket}?list-type=2&max-keys=1000${this.prefix ? `&prefix=${this.prefix}` : ""}`;
      const resp = await fetch(url);
      if (!resp.ok) throw new Error(`R2 API error: ${resp.status}`);
      const text = await resp.text();

      const keys = [...text.matchAll(/<Key>([^<]+)<\/Key>/g)].map((m) => m[1]);
      const sizes = [...text.matchAll(/<Size>([^<]+)<\/Size>/g)].map((m) => m[1]);

      const docs: ConnectorDocument[] = keys.map((key, i) => ({
        id: `r2:${this.bucket}:${key}`, source: DocumentSource.R2, title: key.split("/").pop() ?? key,
        sourceUrl: `${endpoint}/${this.bucket}/${key}`,
        sections: [{ type: SectionType.TEXT as const, content: `R2 Object: ${key}\nBucket: ${this.bucket}\nSize: ${sizes[i]} bytes` }],
        metadata: { type: "r2_object", bucket: this.bucket, key, size: Number(sizes[i]) },
      }));
      if (docs.length > 0) yield docs;
    } catch (err) { yield { error: `R2 fetch failed: ${(err as Error).message}` }; }
  }
}
