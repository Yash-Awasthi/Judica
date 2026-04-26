/**
 * Phase 8.9 — TypeScript strict types for Dockerode dynamic import
 *
 * Replaces `any` in the dockerode dynamic import pattern with proper typed
 * interfaces matching the dockerode API surface used in dockerSandbox.ts
 * and sessionManager.ts.
 *
 * Ref: typescript-strict-plugin, ts-reset (MIT, 8k stars)
 *      https://github.com/total-typescript/ts-reset
 *
 * These types are a minimal subset of the dockerode API — only the methods
 * actually called in the codebase. They prevent incorrect usage at compile
 * time without adding the full dockerode @types package as a hard dependency.
 */

// ─── Container Types ──────────────────────────────────────────────────────────

export interface DockerContainerInfo {
  Id: string;
  Names: string[];
  Image: string;
  State: string;
  Status: string;
  Labels: Record<string, string>;
}

export interface DockerExecOptions {
  AttachStdout: boolean;
  AttachStderr: boolean;
  Cmd: string[];
}

export interface DockerExecInspect {
  ExitCode: number;
  Running: boolean;
}

export interface DockerExecInstance {
  start(opts: { hijack: boolean; stdin: boolean }): Promise<NodeJS.ReadableStream>;
  inspect(): Promise<DockerExecInspect>;
}

export interface DockerContainer {
  id: string;
  inspect(): Promise<{ State: { Status: string; Running: boolean } }>;
  start(): Promise<void>;
  stop(opts?: { t?: number }): Promise<void>;
  remove(opts?: { force?: boolean; v?: boolean }): Promise<void>;
  exec(opts: DockerExecOptions): Promise<DockerExecInstance>;
  putArchive(stream: NodeJS.ReadableStream, opts: { path: string }): Promise<void>;
  getArchive(opts: { path: string }): Promise<NodeJS.ReadableStream>;
  wait(): Promise<{ StatusCode: number }>;
}

// ─── Volume Types ─────────────────────────────────────────────────────────────

export interface DockerVolume {
  inspect(): Promise<{ Name: string; Mountpoint: string }>;
  remove(): Promise<void>;
}

export interface DockerVolumeCreateOptions {
  Name: string;
  Driver?: string;
  DriverOpts?: Record<string, string>;
  Labels?: Record<string, string>;
}

// ─── Container Create Options ─────────────────────────────────────────────────

export interface DockerContainerCreateOptions {
  Image: string;
  Cmd?: string[];
  Entrypoint?: string[];
  Env?: string[];
  WorkingDir?: string;
  User?: string;
  Labels?: Record<string, string>;
  AttachStdin?: boolean;
  AttachStdout?: boolean;
  AttachStderr?: boolean;
  OpenStdin?: boolean;
  StdinOnce?: boolean;
  Tty?: boolean;
  HostConfig?: {
    Memory?: number;
    MemorySwap?: number;
    CpuPeriod?: number;
    CpuQuota?: number;
    NetworkMode?: string;
    ReadonlyRootfs?: boolean;
    Binds?: string[];
    Mounts?: Array<{
      Type: string;
      Source: string;
      Target: string;
      ReadOnly?: boolean;
    }>;
    SecurityOpt?: string[];
    CapDrop?: string[];
    PidsLimit?: number;
    Ulimits?: Array<{ Name: string; Soft: number; Hard: number }>;
  };
  NetworkingConfig?: {
    EndpointsConfig?: Record<string, { IPAMConfig?: { IPv4Address?: string } }>;
  };
}

// ─── Docker Client Interface ──────────────────────────────────────────────────

export interface DockerClient {
  listContainers(opts?: { all?: boolean; filters?: Record<string, string[]> }): Promise<DockerContainerInfo[]>;
  getContainer(id: string): DockerContainer;
  createContainer(opts: DockerContainerCreateOptions): Promise<DockerContainer>;
  getVolume(name: string): DockerVolume;
  createVolume(opts: DockerVolumeCreateOptions): Promise<DockerVolume>;
  modem: {
    demuxStream(
      stream: NodeJS.ReadableStream,
      stdout: NodeJS.WritableStream,
      stderr: NodeJS.WritableStream
    ): void;
    followProgress(
      stream: NodeJS.ReadableStream,
      onFinished: (err: Error | null, output: unknown[]) => void,
      onProgress?: (event: unknown) => void
    ): void;
  };
  pull(image: string, opts?: Record<string, unknown>): Promise<NodeJS.ReadableStream>;
  ping(): Promise<unknown>;
}

// ─── Constructor Type ─────────────────────────────────────────────────────────

export interface DockerConstructor {
  new (opts?: {
    socketPath?: string;
    host?: string;
    port?: number;
    protocol?: string;
    ca?: string;
    cert?: string;
    key?: string;
  }): DockerClient;
}

// ─── Stream Helper Types ──────────────────────────────────────────────────────

export interface DockerProgressEvent {
  status?: string;
  progress?: string;
  id?: string;
  error?: string;
}
