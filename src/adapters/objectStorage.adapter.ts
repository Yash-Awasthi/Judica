/**
 * Unified Object Storage Adapter
 *
 * Supports MinIO, AWS S3, Cloudflare R2, GCS, and local disk fallback.
 * Provider selected via STORAGE_PROVIDER env var.
 *
 * For MinIO/S3/R2: uses @aws-sdk/client-s3 and @aws-sdk/s3-request-presigner
 * if available, otherwise throws a clear configuration error.
 *
 * For local: uses Node.js fs/promises, writing to /tmp/judica-storage.
 */

import fs from "fs/promises";
import path from "path";
import { createReadStream } from "fs";
import logger from "../lib/logger.js";

// Lazy-loaded S3 types to avoid hard dependency
type S3Client = import("@aws-sdk/client-s3").S3Client;
type S3ClientConfig = import("@aws-sdk/client-s3").S3ClientConfig;

const LOCAL_STORAGE_DIR = process.env.LOCAL_STORAGE_DIR ?? "/tmp/judica-storage";

type StorageProvider = "minio" | "s3" | "r2" | "gcs" | "local";

function getProvider(): StorageProvider {
  const raw = process.env.STORAGE_PROVIDER?.toLowerCase();
  if (!raw) return "local";
  if (raw === "minio" || raw === "s3" || raw === "r2" || raw === "gcs" || raw === "local") {
    return raw as StorageProvider;
  }
  logger.warn({ STORAGE_PROVIDER: raw }, "Unknown STORAGE_PROVIDER — falling back to local disk");
  return "local";
}

/**
 * Try to dynamically load @aws-sdk/client-s3 and @aws-sdk/s3-request-presigner.
 * Returns null if the packages are not installed, allowing graceful fallback.
 */
async function loadS3Sdk(): Promise<{
  S3Client: typeof import("@aws-sdk/client-s3").S3Client;
  PutObjectCommand: typeof import("@aws-sdk/client-s3").PutObjectCommand;
  GetObjectCommand: typeof import("@aws-sdk/client-s3").GetObjectCommand;
  DeleteObjectCommand: typeof import("@aws-sdk/client-s3").DeleteObjectCommand;
  ListObjectsV2Command: typeof import("@aws-sdk/client-s3").ListObjectsV2Command;
  getSignedUrl: typeof import("@aws-sdk/s3-request-presigner").getSignedUrl;
} | null> {
  try {
    const [clientMod, presignerMod] = await Promise.all([
      import("@aws-sdk/client-s3"),
      import("@aws-sdk/s3-request-presigner"),
    ]);
    return {
      S3Client: clientMod.S3Client,
      PutObjectCommand: clientMod.PutObjectCommand,
      GetObjectCommand: clientMod.GetObjectCommand,
      DeleteObjectCommand: clientMod.DeleteObjectCommand,
      ListObjectsV2Command: clientMod.ListObjectsV2Command,
      getSignedUrl: presignerMod.getSignedUrl,
    };
  } catch {
    return null;
  }
}

export class ObjectStorageAdapter {
  private readonly provider: StorageProvider;
  private s3Client: S3Client | null = null;
  private s3Sdk: Awaited<ReturnType<typeof loadS3Sdk>> = null;
  private readonly bucket: string;
  private localDir: string;

  constructor() {
    this.provider = getProvider();
    this.bucket = process.env.STORAGE_BUCKET ?? "judica";
    this.localDir = LOCAL_STORAGE_DIR;
  }

  // ─── Initialization ───────────────────────────────────────────────────────

  private async ensureS3(): Promise<{
    client: S3Client;
    sdk: NonNullable<Awaited<ReturnType<typeof loadS3Sdk>>>;
  }> {
    if (!this.s3Sdk) {
      this.s3Sdk = await loadS3Sdk();
    }
    if (!this.s3Sdk) {
      throw new Error(
        `STORAGE_PROVIDER is '${this.provider}' but @aws-sdk/client-s3 is not installed. ` +
          "Run: npm install @aws-sdk/client-s3 @aws-sdk/s3-request-presigner",
      );
    }
    if (!this.s3Client) {
      this.s3Client = this.buildS3Client(this.s3Sdk.S3Client);
    }
    return { client: this.s3Client, sdk: this.s3Sdk };
  }

  private buildS3Client(S3ClientCtor: typeof import("@aws-sdk/client-s3").S3Client): S3Client {
    const config: S3ClientConfig = {
      region: process.env.STORAGE_REGION ?? process.env.AWS_REGION ?? "us-east-1",
    };

    const accessKeyId = process.env.STORAGE_ACCESS_KEY_ID ?? process.env.AWS_ACCESS_KEY_ID;
    const secretAccessKey =
      process.env.STORAGE_SECRET_ACCESS_KEY ?? process.env.AWS_SECRET_ACCESS_KEY;
    if (accessKeyId && secretAccessKey) {
      config.credentials = { accessKeyId, secretAccessKey };
    }

    // MinIO / R2 / self-hosted S3: custom endpoint
    const endpoint = process.env.STORAGE_ENDPOINT;
    if (endpoint) {
      config.endpoint = endpoint;
      // MinIO and most self-hosted S3 clones require path-style addressing
      config.forcePathStyle = process.env.STORAGE_FORCE_PATH_STYLE !== "false";
    }

    logger.debug(
      {
        provider: this.provider,
        region: config.region,
        bucket: this.bucket,
        hasEndpoint: !!endpoint,
        hasCredentials: !!accessKeyId,
      },
      "ObjectStorageAdapter: initializing S3 client",
    );

    return new S3ClientCtor(config);
  }

  private async ensureLocalDir(): Promise<void> {
    await fs.mkdir(this.localDir, { recursive: true });
  }

  private localPath(key: string): string {
    // Prevent path traversal: strip leading slashes and resolve any ".."
    const safe = path.normalize(key).replace(/^(\.\.\/|\.\.\\|\/|\\)+/, "");
    return path.join(this.localDir, safe);
  }

  // ─── Public API ───────────────────────────────────────────────────────────

  /**
   * Upload a file and return its public or signed URL.
   */
  async upload(key: string, buffer: Buffer, mimeType: string): Promise<string> {
    if (this.provider === "local") {
      return this.localUpload(key, buffer);
    }

    const { client, sdk } = await this.ensureS3();
    await client.send(
      new sdk.PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: buffer,
        ContentType: mimeType,
      }),
    );

    // Return a signed URL valid for 1 hour by default
    return this.getSignedUrl(key, 3600);
  }

  /**
   * Download a file and return its contents as a Buffer.
   */
  async download(key: string): Promise<Buffer> {
    if (this.provider === "local") {
      return this.localDownload(key);
    }

    const { client, sdk } = await this.ensureS3();
    const response = await client.send(
      new sdk.GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
      }),
    );

    if (!response.Body) {
      throw new Error(`ObjectStorage: empty response body for key '${key}'`);
    }

    // Collect streaming body into a Buffer
    const chunks: Buffer[] = [];
    for await (const chunk of response.Body as AsyncIterable<Uint8Array>) {
      chunks.push(Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }

  /**
   * Delete a file by key.
   */
  async delete(key: string): Promise<void> {
    if (this.provider === "local") {
      return this.localDelete(key);
    }

    const { client, sdk } = await this.ensureS3();
    await client.send(
      new sdk.DeleteObjectCommand({
        Bucket: this.bucket,
        Key: key,
      }),
    );
  }

  /**
   * Generate a pre-signed download URL.
   * @param expirySeconds defaults to 3600 (1 hour)
   */
  async getSignedUrl(key: string, expirySeconds = 3600): Promise<string> {
    if (this.provider === "local") {
      // Local: return a file URI path for internal use (not a real signed URL)
      return `file://${this.localPath(key)}`;
    }

    const { client, sdk } = await this.ensureS3();
    const command = new sdk.GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
    });

    return sdk.getSignedUrl(client, command, { expiresIn: expirySeconds });
  }

  /**
   * List all keys with the given prefix.
   */
  async listKeys(prefix: string): Promise<string[]> {
    if (this.provider === "local") {
      return this.localListKeys(prefix);
    }

    const { client, sdk } = await this.ensureS3();
    const keys: string[] = [];
    let continuationToken: string | undefined;

    do {
      const response = await client.send(
        new sdk.ListObjectsV2Command({
          Bucket: this.bucket,
          Prefix: prefix,
          ContinuationToken: continuationToken,
          MaxKeys: 1000,
        }),
      );

      for (const obj of response.Contents ?? []) {
        if (obj.Key) keys.push(obj.Key);
      }

      continuationToken = response.NextContinuationToken;
    } while (continuationToken);

    return keys;
  }

  // ─── Local Disk Implementation ────────────────────────────────────────────

  private async localUpload(key: string, buffer: Buffer): Promise<string> {
    await this.ensureLocalDir();
    const filePath = this.localPath(key);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, buffer, { mode: 0o600 });
    logger.debug({ key, bytes: buffer.length }, "ObjectStorageAdapter: local upload");
    return `file://${filePath}`;
  }

  private async localDownload(key: string): Promise<Buffer> {
    const filePath = this.localPath(key);
    try {
      return await fs.readFile(filePath);
    } catch (err: unknown) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "ENOENT") {
        throw new Error(`ObjectStorage: key not found '${key}'`, { cause: err });
      }
      throw err;
    }
  }

  private async localDelete(key: string): Promise<void> {
    const filePath = this.localPath(key);
    try {
      await fs.unlink(filePath);
    } catch (err: unknown) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== "ENOENT") throw err;
      // Already deleted — treat as success
    }
  }

  private async localListKeys(prefix: string): Promise<string[]> {
    await this.ensureLocalDir();

    const safePrefix = path.normalize(prefix).replace(/^(\.\.\/|\.\.\\|\/|\\)+/, "");
    const searchDir = safePrefix.includes(path.sep)
      ? path.join(this.localDir, path.dirname(safePrefix))
      : this.localDir;

    const keys: string[] = [];

    async function walk(dir: string, base: string): Promise<void> {
      let entries: import("fs").Dirent[];
      try {
        entries = await fs.readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        const relKey = base ? `${base}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
          await walk(path.join(dir, entry.name), relKey);
        } else if (relKey.startsWith(safePrefix)) {
          keys.push(relKey);
        }
      }
    }

    await walk(searchDir, safePrefix.includes(path.sep) ? path.dirname(safePrefix) : "");

    // Filter to only keys that start with the requested prefix
    return keys.filter((k) => k.startsWith(safePrefix));
  }
}

// Singleton instance shared across the application
export const objectStorage = new ObjectStorageAdapter();
