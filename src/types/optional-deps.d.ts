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
