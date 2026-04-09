import { ProviderConfig, ProviderResponse, Message } from "./types.js";

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
