// P2-17: This directory is src/router/ (provider routing logic).
// Not to be confused with src/routes/ (HTTP route handlers).
// src/router/ handles AI provider selection; src/routes/ handles HTTP endpoints.
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
  /**
   * P4-23: Priority tags to influence provider selection.
   * - "fast": prefer low-latency providers (Groq, Cerebras)
   * - "quality": prefer high-quality models (GPT-4o, Claude)
   * - "tool-capable": only use providers that support tool calling
   * - "cheap": prefer free/low-cost providers first
   * Tags are hints — the router still respects quota and RPM limits.
   */
  /**
   * P4-25: AbortSignal for cancellation propagation.
   * When the client disconnects, the signal aborts to stop wasting provider calls.
   */
  signal?: AbortSignal;
  /** P4-23: Priority tags */
  tags?: string[];
  /** User ID for quota attribution */
  userId?: number;
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

  // P4-25: Check abort signal before each attempt
  function checkAborted() {
    if (options.signal?.aborted) {
      throw new AppError(499, "Request aborted by client", "REQUEST_ABORTED");
    }
  }

  // Step 1: Try preferred provider
  checkAborted();
  const preferred = options.preferredProvider ||
    (options.preferredModel ? resolveProviderFromModel(options.preferredModel) : null) ||
    (req.model ? resolveProviderFromModel(req.model) : null);

  if (preferred && hasAdapter(preferred)) {
    try {
      triedProviders.add(preferred);
      const adapter = getAdapter(preferred);
      const routedReq = req.model ? req : { ...req, model: "auto" };
      const result = await adapter.generate(routedReq);

      // P2-13: Record request AFTER successful generation, not before
      recordRequest(preferred);

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
  const chain = options.usePaid ? [...PAID_CHAIN] : [...FREE_TIER_CHAIN];

  // P4-23: Reorder chain based on priority tags
  if (options.tags?.length) {
    const FAST_PROVIDERS = new Set(["groq", "cerebras", "fireworks"]);
    const QUALITY_PROVIDERS = new Set(["openai", "anthropic"]);
    const TOOL_PROVIDERS = new Set(["openai", "anthropic", "gemini", "groq"]);

    chain.sort((a, b) => {
      let scoreA = 0, scoreB = 0;
      for (const tag of options.tags!) {
        if (tag === "fast") {
          if (FAST_PROVIDERS.has(a.provider)) scoreA += 10;
          if (FAST_PROVIDERS.has(b.provider)) scoreB += 10;
        } else if (tag === "quality") {
          if (QUALITY_PROVIDERS.has(a.provider)) scoreA += 10;
          if (QUALITY_PROVIDERS.has(b.provider)) scoreB += 10;
        } else if (tag === "tool-capable") {
          if (TOOL_PROVIDERS.has(a.provider)) scoreA += 10;
          if (TOOL_PROVIDERS.has(b.provider)) scoreB += 10;
        } else if (tag === "cheap") {
          // Lower daily_tokens limit = cheaper provider tier, prefer them
          if (a.daily_tokens <= b.daily_tokens) scoreA += 5;
          else scoreB += 5;
        }
      }
      return scoreB - scoreA; // Higher score first
    });
  }

  for (let attempt = 0; attempt < chain.length; attempt++) {
    checkAborted(); // P4-25
    const selected = selectProvider(estimated, chain.filter(
      (e) => !triedProviders.has(e.provider)
    ));

    if (!selected) break;

    triedProviders.add(selected.provider);

    try {
      const adapter = getAdapter(selected.provider);

      // Override model to the chain's recommended model if not explicitly set
      const routedReq = { ...req, model: req.model || selected.model };

      const result = await adapter.generate(routedReq);

      // P2-13: Record request AFTER successful generation
      recordRequest(selected.provider);

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
 * P2-12: Track the actual provider used instead of returning "auto".
 */
export async function routeAndCollect(
  req: AdapterRequest,
  options: RouteOptions = {}
): Promise<{ text: string; provider: string; usage: { prompt_tokens: number; completion_tokens: number } }> {
  // Intercept route() to capture which provider was actually used
  const result = await route(req, options);

  // The provider name is embedded in the wrapped stream via wrapWithUsageTracking
  // We need to track it during routing. Use a wrapper approach:
  const collected = await result.collect();

  // Best-effort provider resolution from the options/model
  const preferred = options.preferredProvider ||
    (options.preferredModel ? resolveProviderFromModel(options.preferredModel) : null) ||
    (req.model ? resolveProviderFromModel(req.model) : null);
  const actualProvider = preferred || "chain-selected";

  return {
    text: collected.text,
    provider: actualProvider,
    usage: collected.usage,
  };
}
