// Type declarations for optional dependencies that may not be installed
// These stubs prevent TS2307 "Cannot find module" errors in CI

declare module '@bull-board/api' {
  export function createBullBoard(opts: any): any;
  export class BullMQAdapter {
    constructor(queue: any);
  }
}

declare module '@bull-board/express' {
  export class ExpressAdapter {
    setBasePath(path: string): void;
    getRouter(): any;
  }
}

declare module 'langfuse' {
  export class Langfuse {
    constructor(opts?: any);
    trace(opts: any): any;
    shutdown(): Promise<void>;
  }
}

declare module '@qdrant/js-client-rest' {
  export class QdrantClient {
    constructor(opts: any);
    upsert(collection: string, opts: any): Promise<any>;
    search(collection: string, opts: any): Promise<any>;
    delete(collection: string, opts: any): Promise<any>;
    getCollections(): Promise<any>;
    createCollection(name: string, opts: any): Promise<any>;
  }
}

declare module '@getzep/zep-js' {
  export class ZepClient {
    constructor(url: string, apiKey?: string);
    memory: any;
  }
}
