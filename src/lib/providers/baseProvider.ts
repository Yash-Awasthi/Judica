import { ProviderConfig, ProviderResponse, Message } from "./types.js";

/**
 * Base provider interface for all AI council members.
 * Implements common logic for error handling, timeouts, and signal propagation.
 */
export abstract class BaseProvider {
  public readonly name: string;
  public readonly type: string;

  constructor(protected readonly config: ProviderConfig) {
    this.name = config.name;
    this.type = config.type;
  }

  /**
   * Main call method for generating responses.
   * Standardizes the input and output format across all provider types.
   */
  abstract call(params: {
    messages: Message[];
    prompt?: string;
    signal?: AbortSignal;
    maxTokens?: number;
    isFallback?: boolean;
  }): Promise<ProviderResponse>;

  /**
   * Mask sensitive information (like API keys) in logs.
   * Decision: Enforce log sanitization.
   */
  protected maskConfig() {
    const masked = { ...this.config };
    if (masked.apiKey) {
      // Use standard masking decision: slice(0, 4) + "****"
      masked.apiKey = masked.apiKey.length > 4 
        ? masked.apiKey.slice(0, 4) + "****"
        : "****";
    }
    return masked;
  }
}
