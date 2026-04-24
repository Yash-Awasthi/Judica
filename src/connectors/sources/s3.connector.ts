/**
 * S3 Connector — loads objects from AWS S3 buckets.
 * Supports: LoadConnector, PollConnector.
 */

import type { BaseConnectorConfig, LoadConnector, PollConnector } from "../interfaces.js";
import type { ConnectorDocument, ConnectorFailure } from "../models.js";
import { DocumentSource, SectionType } from "../models.js";

export class S3Connector implements LoadConnector, PollConnector {
  readonly displayName = "Amazon S3";
  readonly sourceType = DocumentSource.S3;

  private config!: BaseConnectorConfig;
  private accessKeyId!: string;
  private secretAccessKey!: string;
  private region = "us-east-1";
  private bucket!: string;
  private prefix = "";

  async init(config: BaseConnectorConfig): Promise<void> {
    this.config = config;
    const s = config.settings;
    this.bucket = s.bucket as string;
    this.prefix = (s.prefix as string) ?? "";
    this.region = (s.region as string) ?? "us-east-1";
  }

  async loadCredentials(credentials: Record<string, unknown>): Promise<void> {
    this.accessKeyId = credentials.aws_access_key_id as string;
    this.secretAccessKey = credentials.aws_secret_access_key as string;
  }

  async validateSettings(): Promise<{ valid: boolean; errors: string[] }> {
    const errors: string[] = [];
    if (!this.accessKeyId) errors.push("aws_access_key_id is required");
    if (!this.secretAccessKey) errors.push("aws_secret_access_key is required");
    if (!this.bucket) errors.push("bucket is required");
    return { valid: errors.length === 0, errors };
  }

  async *loadFromState(): AsyncGenerator<ConnectorDocument[] | ConnectorFailure> {
    yield* this.listObjects();
  }

  async *pollSource(
    startEpochSecs: number,
  ): AsyncGenerator<ConnectorDocument[] | ConnectorFailure> {
    yield* this.listObjects(startEpochSecs);
  }

  private async *listObjects(
    sinceEpoch?: number,
  ): AsyncGenerator<ConnectorDocument[] | ConnectorFailure> {
    let continuationToken: string | undefined;

    do {
      try {
        const params = new URLSearchParams({ "list-type": "2", "max-keys": "1000" });
        if (this.prefix) params.set("prefix", this.prefix);
        if (continuationToken) params.set("continuation-token", continuationToken);

        const url = `https://${this.bucket}.s3.${this.region}.amazonaws.com/?${params}`;
        const resp = await this.signedRequest("GET", url);
        const text = await resp.text();

        // Simple XML parsing for ListObjectsV2 response
        const keys = [...text.matchAll(/<Key>([^<]+)<\/Key>/g)].map((m) => m[1]);
        const lastModifieds = [...text.matchAll(/<LastModified>([^<]+)<\/LastModified>/g)].map((m) => m[1]);
        const sizes = [...text.matchAll(/<Size>([^<]+)<\/Size>/g)].map((m) => m[1]);
        const isTruncated = text.includes("<IsTruncated>true</IsTruncated>");
        const nextToken = text.match(/<NextContinuationToken>([^<]+)<\/NextContinuationToken>/)?.[1];

        const docs: ConnectorDocument[] = [];
        for (let i = 0; i < keys.length; i++) {
          const modified = lastModifieds[i];
          if (sinceEpoch && modified) {
            if (Math.floor(new Date(modified).getTime() / 1000) < sinceEpoch) continue;
          }
          docs.push({
            id: `s3:${this.bucket}:${keys[i]}`,
            source: DocumentSource.S3,
            title: keys[i].split("/").pop() ?? keys[i],
            sourceUrl: `https://${this.bucket}.s3.${this.region}.amazonaws.com/${keys[i]}`,
            sections: [{
              type: SectionType.TEXT,
              content: `S3 Object: ${keys[i]}\nBucket: ${this.bucket}\nSize: ${sizes[i]} bytes`,
            }],
            metadata: { type: "s3_object", bucket: this.bucket, key: keys[i], size: Number(sizes[i]) },
            lastModifiedEpochSecs: modified ? Math.floor(new Date(modified).getTime() / 1000) : undefined,
          });
        }

        if (docs.length > 0) yield docs;
        continuationToken = isTruncated ? nextToken : undefined;
      } catch (err) {
        yield { error: `S3 list objects failed: ${(err as Error).message}` };
        break;
      }
    } while (continuationToken);
  }

  private async signedRequest(method: string, url: string): Promise<Response> {
    // Simplified — production should use AWS Signature V4
    // For now, use basic auth headers; full SigV4 requires crypto.subtle
    const resp = await fetch(url, {
      method,
      headers: {
        "x-amz-content-sha256": "UNSIGNED-PAYLOAD",
      },
    });
    if (!resp.ok) throw new Error(`S3 API error: ${resp.status} ${resp.statusText}`);
    return resp;
  }
}
