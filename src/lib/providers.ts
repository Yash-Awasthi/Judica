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

export type { Message, ProviderResponse, ProviderUsage, Provider };

export async function askProvider(
  providerConfig: Provider,
  messages: Message[] | string,
  isFallback = false,
  abortSignal?: AbortSignal,
  onChunk?: (chunk: string) => void
): Promise<ProviderResponse> {
  const normMessages: Message[] = typeof messages === "string"
    ? [{ role: "user", content: messages }]
    : messages;

  const prompt = typeof messages === "string" 
    ? messages 
    : messages.map(m => typeof m.content === "string" ? m.content : JSON.stringify(m.content)).join("\n");

  try {
    const provider = createProvider(providerConfig);
    
    return await provider.call({
      messages: normMessages,
      prompt,
      signal: abortSignal,
      isFallback,
      onChunk
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
        return askProvider(fallback, messages, true, abortSignal, onChunk);
      }
    }

    if (err instanceof Error && (err.message.includes("missing required 'type' field") || err.message.includes("invalid type"))) {
      throw err;
    }
    
    throw new Error(`${providerConfig.type} provider request failed`, { cause: err });
  }
}

export async function askProviderStream(
  providerConfig: Provider,
  messages: Message[] | string,
  onChunk: (chunk: string) => void,
  isFallback = false,
  abortSignal?: AbortSignal
): Promise<ProviderResponse> {
  try {
    return await withRetry(async () => {
      return await askProvider(providerConfig, messages, isFallback, abortSignal, onChunk);
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
    if (_err instanceof Error && (_err.message.includes("missing required 'type' field") || _err.message.includes("invalid type"))) {
      throw _err;
    }
    throw new Error(`Provider stream failed`, { cause: _err });
  }
}