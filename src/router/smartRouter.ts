import type { AdapterRequest, AdapterChunk, AdapterStreamResult } from "../adapters/types.js";
import { getAdapter, resolveProviderFromModel, listAvailableProviders, hasAdapter } from "../adapters/registry.js";
import { recordUsage } from "./quotaTracker.js";
import { recordRequest } from "./rpmLimiter.js";
import { estimateTokens } from "./tokenEstimator.js";
import { selectProvider, FREE_TIER_CHAIN, PAID_CHAIN } from "./providerChain.js";
import { createStreamResult } from "../adapters/types.js";
import { AppError } from "../middleware/errorHandler.js";
import logger from "../lib/logger.js";

// Routes requests to the best available provider. Handles fallback on failure.

export interface RouteOptions {
  /** Preferred provider ID. If set, tries this first. */
  preferredProvider?: string;
  /** Preferred model. Used to auto-resolve provider. */
  preferredModel?: string;
  /** Use paid providers instead of free tier chain */
  usePaid?: boolean;
}

/**
 * Route an adapter request to the best available provider.
 *
 * 1. If preferredProvider is set → try it
 * 2. If preferredModel set → resolve provider from model name
 * 3. If fails or quota exceeded → run selectProvider() from chain
 * 4. On error (429/500): retry next in chain
 * 5. If all providers fail: throw 503
 */
export async function route(
  req: AdapterRequest,
  options: RouteOptions = {}
): Promise<AdapterStreamResult> {
  const estimated = estimateTokens(req.messages);
  const triedProviders = new Set<string>();
  let lastError: Error | null = null;

  // Step 1: Try preferred provider
  const preferred = options.preferredProvider ||
    (options.preferredModel ? resolveProviderFromModel(options.preferredModel) : null) ||
    (req.model ? resolveProviderFromModel(req.model) : null);

  if (preferred && hasAdapter(preferred)) {
    try {
      triedProviders.add(preferred);
      recordRequest(preferred);
      const adapter = getAdapter(preferred);
      const result = await adapter.generate(req);

      // Wrap to record usage after stream completes
      return wrapWithUsageTracking(result, preferred);
    } catch (err) {
      lastError = err as Error;
      logger.warn({
        provider: preferred,
        error: (err as Error).message
      }, "Preferred provider failed, falling back");
    }
  }

  // Step 2: Try chain-based selection
  const chain = options.usePaid ? PAID_CHAIN : FREE_TIER_CHAIN;

  for (let attempt = 0; attempt < chain.length; attempt++) {
    const selected = selectProvider(estimated, chain.filter(
      (e) => !triedProviders.has(e.provider)
    ));

    if (!selected) break;

    triedProviders.add(selected.provider);

    try {
      recordRequest(selected.provider);
      const adapter = getAdapter(selected.provider);

      // Override model to the chain's recommended model if not explicitly set
      const routedReq = { ...req, model: req.model || selected.model };

      const result = await adapter.generate(routedReq);

      logger.info({
        provider: selected.provider,
        model: routedReq.model,
        fallback: attempt > 0
      }, "Request routed successfully");

      return wrapWithUsageTracking(result, selected.provider);
    } catch (err) {
      lastError = err as Error;
      logger.warn({
        provider: selected.provider,
        error: (err as Error).message,
        attempt: attempt + 1,
      }, "Provider failed, trying next in chain");
    }
  }

  // All providers exhausted
  const available = listAvailableProviders();
  logger.error({
    triedProviders: Array.from(triedProviders),
    available,
    lastError: lastError?.message
  }, "All providers exhausted");

  throw new AppError(
    503,
    `All providers exhausted. Tried: ${Array.from(triedProviders).join(", ")}. Last error: ${lastError?.message || "unknown"}`,
    "PROVIDERS_EXHAUSTED"
  );
}

/**
 * Wrap a stream result to automatically record usage when the stream completes.
 */
function wrapWithUsageTracking(
  result: AdapterStreamResult,
  provider: string
): AdapterStreamResult {
  const originalStream = result.stream;

  async function* trackedStream(): AsyncGenerator<AdapterChunk> {
    let totalTokens = 0;

    for await (const chunk of originalStream) {
      if (chunk.type === "usage" && chunk.usage) {
        totalTokens = (chunk.usage.prompt_tokens || 0) + (chunk.usage.completion_tokens || 0);
      }
      yield chunk;
    }

    // Record usage when stream ends
    if (totalTokens > 0) {
      recordUsage(provider, totalTokens);
    }
  }

  return createStreamResult(trackedStream());
}

/**
 * Quick route for simple text completion — non-streaming, returns collected text.
 */
export async function routeAndCollect(
  req: AdapterRequest,
  options: RouteOptions = {}
): Promise<{ text: string; provider: string; usage: { prompt_tokens: number; completion_tokens: number } }> {
  // Force non-stream by collecting
  const result = await route(req, options);
  const collected = await result.collect();

  return {
    text: collected.text,
    provider: options.preferredProvider || "auto",
    usage: collected.usage,
  };
}
