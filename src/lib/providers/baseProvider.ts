import type { ProviderConfig, ProviderResponse, Message } from "./types.js";
import { getBreaker } from "../breaker.js";

// Default per-request timeout (30s) to prevent indefinite hangs
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;

export abstract class BaseProvider {
  public readonly name: string;
  public readonly type: string;

  constructor(protected readonly config: ProviderConfig) {
    this.name = config.name;
    this.type = config.type;
  }

  abstract call(params: {
    messages: Message[];
    prompt?: string;
    signal?: AbortSignal;
    maxTokens?: number;
    isFallback?: boolean;
    onChunk?: (chunk: string) => void;
  }): Promise<ProviderResponse>;

  /**
   * Wraps a fetch call through the circuit breaker for this provider.
   * All concrete providers should use this instead of calling fetch() directly
   * so that repeated failures trigger the breaker and prevent cascading outages.
   * Adds AbortSignal.timeout() fallback if no signal is provided.
   */
  protected async protectedFetch(
    url: string,
    init: RequestInit,
  ): Promise<Response> {
    // Enforce a timeout even when no AbortSignal is supplied
    // NaN guard on timeoutMs
    let timeoutMs = this.config.timeoutMs || DEFAULT_REQUEST_TIMEOUT_MS;
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS;
    timeoutMs = Math.min(timeoutMs, 300_000); // Hard cap at 5 minutes
    if (!init.signal) {
      init = { ...init, signal: AbortSignal.timeout(timeoutMs) };
    }
    const fetchFn = async () => fetch(url, init);
    // Give the function a name for the breaker registry key
    Object.defineProperty(fetchFn, "name", { value: "fetch" });
    const breaker = getBreaker({ name: this.name } as ProviderConfig, fetchFn);
    return await breaker.fire() as Response;
  }

  protected maskConfig() {
    const masked = { ...this.config };
    if (masked.apiKey) {
      // Only reveal prefix for keys longer than 8 chars
      masked.apiKey = masked.apiKey.length > 8
        ? masked.apiKey.slice(0, 4) + "****"
        : "****";
    }
    return masked;
  }
}
