// P2-02: DEPRECATED — This module is the legacy provider entry point.
// New code should use src/adapters/ + src/router/smartRouter.ts instead.
// This file will be removed once all callers are migrated.
import { withRetry } from "./retry.js";
import { getFallbackProvider } from "../config/fallbacks.js";
import logger from "./logger.js";
import { createProvider } from "./providers/factory.js";
import type {
  Message,
  ProviderResponse,
  ProviderUsage,
  ProviderConfig as Provider
} from "./providers/types.js";

export type { Message, ProviderResponse, ProviderUsage, Provider };

// P7-13: Typed error classes replace brittle string matching
export class ProviderConfigError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ProviderConfigError";
  }
}

export class ProviderRateLimitError extends Error {
  constructor(message: string, public retryAfterMs?: number, options?: ErrorOptions) {
    super(message, options);
    this.name = "ProviderRateLimitError";
  }
}

// P7-14: Max total attempts guard — caps retry × fallback explosion
const MAX_TOTAL_ATTEMPTS = 6;

// P7-15: Request context object replaces manual isFallback threading
interface RequestContext {
  isFallback: boolean;
  totalAttempts: number;
  triedProviders: string[];
}

export async function askProvider(
  providerConfig: Provider,
  messages: Message[] | string,
  isFallback = false,
  abortSignal?: AbortSignal,
  onChunk?: (chunk: string) => void,
  _ctx?: RequestContext,
): Promise<ProviderResponse> {
  // P7-15: Use context object for propagation
  const ctx: RequestContext = _ctx || { isFallback, totalAttempts: 0, triedProviders: [] };
  ctx.totalAttempts++;
  ctx.triedProviders.push(providerConfig.name);

  // P7-14: Guard against retry × fallback explosion
  if (ctx.totalAttempts > MAX_TOTAL_ATTEMPTS) {
    throw new Error(`Max total attempts (${MAX_TOTAL_ATTEMPTS}) exceeded. Tried: ${ctx.triedProviders.join(", ")}`);
  }

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
      isFallback: ctx.isFallback,
      onChunk
    });

  } catch (err) {
    logger.warn({
      err: (err as Error).message,
      provider: providerConfig.name,
      type: providerConfig.type,
      isFallback: ctx.isFallback,
      totalAttempts: ctx.totalAttempts,
    }, "Provider request failed, checking for fallback");

    // P7-13: Use typed error classes instead of string matching
    if (err instanceof ProviderConfigError) {
      throw err;
    }

    if (!ctx.isFallback) {
      const fallback = getFallbackProvider(providerConfig);
      if (fallback) {
        ctx.isFallback = true;
        return askProvider(fallback, messages, true, abortSignal, onChunk, ctx);
      }
    }

    if (err instanceof Error && (err.message.includes("missing required 'type' field") || err.message.includes("invalid type"))) {
      throw new ProviderConfigError(err.message, { cause: err });
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
  const ctx: RequestContext = { isFallback, totalAttempts: 0, triedProviders: [] };

  try {
    return await withRetry(async () => {
      ctx.totalAttempts++;
      // P7-14: Check max attempts inside retry loop
      if (ctx.totalAttempts > MAX_TOTAL_ATTEMPTS) {
        throw new Error(`Max total attempts (${MAX_TOTAL_ATTEMPTS}) exceeded`);
      }
      return await askProvider(providerConfig, messages, isFallback, abortSignal, onChunk, ctx);
    }, {
      onRetry: (err: unknown, attempt: number) => {
        logger.warn({ attempt, error: (err as Error).message }, "Retry initiated for provider call");
      }
    });
  } catch (_err: unknown) {
    if (!ctx.isFallback && (!abortSignal || !abortSignal.aborted)) {
      // P7-14: Check guard before fallback
      if (ctx.totalAttempts < MAX_TOTAL_ATTEMPTS) {
        const fallback = getFallbackProvider(providerConfig);
        if (fallback) {
          ctx.isFallback = true;
          return askProviderStream(fallback, messages, onChunk, true, abortSignal);
        }
      }
    }
    // P7-13: Use typed error class
    if (_err instanceof ProviderConfigError) {
      throw _err;
    }
    if (_err instanceof Error && (_err.message.includes("missing required 'type' field") || _err.message.includes("invalid type"))) {
      throw new ProviderConfigError(_err.message, { cause: _err });
    }
    throw new Error(`Provider stream failed`, { cause: _err });
  }
}