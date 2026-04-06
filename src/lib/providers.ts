import { withRetry } from "./retry.js";
import { getFallbackProvider } from "../config/fallbacks.js";
import logger from "./logger.js";
import { createProvider } from "./providers/factory.js";
import { 
  Message, 
  ProviderResponse, 
  ProviderUsage, 
  ProviderConfig as Provider 
} from "./providers/types.js";

// Re-export types for backward compatibility
export type { Message, ProviderResponse, ProviderUsage, Provider };

/**
 * Main provider dispatcher - uses the unified BaseProvider abstraction.
 * Enforces per-request instantiation to prevent state leakage.
 */
export async function askProvider(
  providerConfig: Provider,
  messages: Message[] | string,
  isFallback = false,
  abortSignal?: AbortSignal
): Promise<ProviderResponse> {
  const normMessages: Message[] = typeof messages === "string"
    ? [{ role: "user", content: messages }]
    : messages;

  const prompt = typeof messages === "string" 
    ? messages 
    : messages.map(m => typeof m.content === "string" ? m.content : JSON.stringify(m.content)).join("\n");

  try {
    // FACTORY: Create a fresh, stateless provider instance for this request
    const provider = createProvider(providerConfig);
    
    return await provider.call({
      messages: normMessages,
      prompt,
      signal: abortSignal,
      isFallback
    });

  } catch (err) {
    logger.warn({ 
      err: (err as Error).message, 
      provider: providerConfig.name, 
      type: providerConfig.type,
      isFallback 
    }, "Provider request failed, checking for fallback");
    
    if (!isFallback) {
      const fallback = getFallbackProvider(providerConfig);
      if (fallback) {
        return askProvider(fallback, messages, true, abortSignal);
      }
    }
    
    throw new Error(`${providerConfig.type} provider request failed`, { cause: err });
  }
}

/**
 * Streaming provider dispatcher.
 * Currently uses standard call for local/rpa, and streaming (if implemented) for API.
 * Note: Full unified streaming support is planned for Phase 4.
 */
export async function askProviderStream(
  providerConfig: Provider,
  messages: Message[] | string,
  onChunk: (chunk: string) => void,
  isFallback = false,
  abortSignal?: AbortSignal
): Promise<ProviderResponse> {
  // Legacy support for streamOpenAI/streamAnthropic/streamGoogle would go here
  // But to harden the interface, we'll use the unified call with retry logic
  try {
    return await withRetry(async () => {
      return await askProvider(providerConfig, messages, isFallback, abortSignal);
    }, {
      onRetry: (err: unknown, attempt: number) => {
        logger.warn({ attempt, error: (err as Error).message }, "Retry initiated for provider call");
      }
    });
  } catch (_err: unknown) {
    if (!isFallback && (!abortSignal || !abortSignal.aborted)) {
      const fallback = getFallbackProvider(providerConfig);
      if (fallback) return askProviderStream(fallback, messages, onChunk, true, abortSignal);
    }
    throw new Error("Provider stream failed", { cause: _err });
  }
}