import { ProviderConfig, ProviderResponse, Message } from "./types.js";
import { getBreaker } from "../breaker.js";

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
   */
  protected async protectedFetch(
    url: string,
    init: RequestInit,
  ): Promise<Response> {
    const fetchFn = async () => fetch(url, init);
    // Give the function a name for the breaker registry key
    Object.defineProperty(fetchFn, "name", { value: "fetch" });
    const breaker = getBreaker({ name: this.name } as ProviderConfig, fetchFn);
    return await breaker.fire() as Response;
  }

  protected maskConfig() {
    const masked = { ...this.config };
    if (masked.apiKey) {
      masked.apiKey = masked.apiKey.length > 4
        ? masked.apiKey.slice(0, 4) + "****"
        : "****";
    }
    return masked;
  }
}
