// Type declarations for optional dependencies that may not be installed
// These stubs prevent TS2307 "Cannot find module" errors in CI

declare module '@bull-board/api' {
  export function createBullBoard(opts: Record<string, unknown>): { addQueue: (q: unknown) => void; removeQueue: (q: unknown) => void };
  export class BullMQAdapter {
    constructor(queue: unknown);
  }
}

// NOTE: Project uses Fastify; this express stub may be unused. See @bull-board/fastify below.
declare module '@bull-board/express' {
  export class ExpressAdapter {
    setBasePath(path: string): void;
    getRouter(): unknown;
  }
}

// The project uses Fastify — add @bull-board/fastify stub
declare module '@bull-board/fastify' {
  export class FastifyAdapter {
    setBasePath(path: string): void;
    plugin(): unknown;
  }
}

declare module 'langfuse' {
  export class Langfuse {
    constructor(opts?: Record<string, unknown>);
    trace(opts: Record<string, unknown>): { span: (opts: Record<string, unknown>) => unknown };
    shutdown(): Promise<void>;
  }
}

declare module '@qdrant/js-client-rest' {
  export class QdrantClient {
    constructor(opts: Record<string, unknown>);
    upsert(collection: string, opts: Record<string, unknown>): Promise<unknown>;
    search(collection: string, opts: Record<string, unknown>): Promise<unknown>;
    delete(collection: string, opts: Record<string, unknown>): Promise<unknown>;
    getCollections(): Promise<{ collections: Array<{ name: string }> }>;
    createCollection(name: string, opts: Record<string, unknown>): Promise<unknown>;
  }
}

declare module '@getzep/zep-js' {
  export class ZepClient {
    constructor(url: string, apiKey?: string);
    memory: Record<string, unknown>;
  }
}

declare module '@aws-sdk/client-s3' {
  export interface S3ClientConfig {
    region?: string;
    endpoint?: string;
    credentials?: { accessKeyId: string; secretAccessKey: string };
    forcePathStyle?: boolean;
    [key: string]: unknown;
  }
  export class S3Client {
    constructor(config: S3ClientConfig);
    send(command: unknown): Promise<any>;
    destroy(): void;
  }
  export class GetObjectCommand {
    constructor(input: Record<string, unknown>);
  }
  export class PutObjectCommand {
    constructor(input: Record<string, unknown>);
  }
  export class DeleteObjectCommand {
    constructor(input: Record<string, unknown>);
  }
  export class HeadObjectCommand {
    constructor(input: Record<string, unknown>);
  }
  export class ListObjectsV2Command {
    constructor(input: Record<string, unknown>);
  }
  export class CreateBucketCommand {
    constructor(input: Record<string, unknown>);
  }
}

declare module '@aws-sdk/s3-request-presigner' {
  import type { S3Client } from '@aws-sdk/client-s3';
  export function getSignedUrl(client: S3Client, command: unknown, options?: { expiresIn?: number }): Promise<string>;
}

declare module '@opentelemetry/sdk-node' {
  export class NodeSDK {
    constructor(config?: Record<string, unknown>);
    start(): void;
    shutdown(): Promise<void>;
  }
}

declare module '@opentelemetry/exporter-trace-otlp-http' {
  export class OTLPTraceExporter {
    constructor(config?: Record<string, unknown>);
  }
}

declare module '@opentelemetry/sdk-trace-base' {
  export class BatchSpanProcessor {
    constructor(exporter: unknown);
  }
  export class SimpleSpanProcessor {
    constructor(exporter: unknown);
  }
}

declare module '@opentelemetry/resources' {
  export class Resource {
    constructor(attributes: Record<string, unknown>);
    static default(): Resource;
    merge(other: Resource): Resource;
  }
}

declare module '@opentelemetry/semantic-conventions' {
  export const SEMRESATTRS_SERVICE_NAME: string;
  export const SEMRESATTRS_SERVICE_VERSION: string;
  export const SEMRESATTRS_DEPLOYMENT_ENVIRONMENT: string;
}

declare module '@opentelemetry/auto-instrumentations-node' {
  export function getNodeAutoInstrumentations(config?: Record<string, unknown>): unknown[];
}

declare module 'dockerode' {
  interface ContainerCreateOptions {
    Image?: string;
    Cmd?: string[];
    Env?: string[];
    HostConfig?: Record<string, unknown>;
    [key: string]: unknown;
  }
  interface Container {
    start(options?: Record<string, unknown>): Promise<unknown>;
    stop(options?: Record<string, unknown>): Promise<unknown>;
    remove(options?: Record<string, unknown>): Promise<unknown>;
    exec(options: Record<string, unknown>): Promise<Exec>;
    logs(options: Record<string, unknown>): Promise<unknown>;
    inspect(): Promise<Record<string, unknown>>;
    wait(): Promise<{ StatusCode: number }>;
  }
  interface Exec {
    start(options?: Record<string, unknown>): Promise<unknown>;
    inspect(): Promise<Record<string, unknown>>;
  }
  class Docker {
    constructor(options?: Record<string, unknown>);
    createContainer(options: ContainerCreateOptions): Promise<Container>;
    getContainer(id: string): Container;
    listContainers(options?: Record<string, unknown>): Promise<unknown[]>;
    pull(image: string, options?: Record<string, unknown>): Promise<unknown>;
    ping(): Promise<unknown>;
  }
  export = Docker;
}
