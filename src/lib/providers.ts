import { withRetry } from "./retry.js";
import { getFallbackProvider } from "../config/fallbacks.js";
import logger from "./logger.js";
import { askAnthropic, streamAnthropic } from "./strategies/anthropic.js";
import { askGoogle, streamGoogle } from "./strategies/google.js";
import { askOpenAI, streamOpenAI } from "./strategies/openai.js";
import { getBreaker } from "./breaker.js";

export interface Message {
  role: "user" | "assistant" | "tool";
  content: string | any[];
  tool_call_id?: string;
  name?: string;
}

export interface ProviderUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface ProviderResponse {
  text: string;
  usage?: ProviderUsage;
}

export interface Provider {
  name: string;
  type: "openai-compat" | "anthropic" | "google";
  apiKey: string;
  model: string;
  baseUrl?: string;
  systemPrompt?: string;
  maxTokens?: number;
  tools?: string[];
}

// ── Structured provider registry ───────────────────────────────────────────────────
interface ProviderRegistryEntry {
  baseUrl?: string;
  type: "openai-compat" | "anthropic" | "google";
  defaultMaxTokens: number;
}

/**
 * Model-prefix registry: maps a substring of the model name to a provider config.
 * Order matters — first match wins. More specific prefixes should come first.
 */
const PROVIDER_REGISTRY: Record<string, ProviderRegistryEntry> = {
  // NVIDIA-hosted OpenAI-compatible models
  "kimi":     { baseUrl: "https://integrate.api.nvidia.com/v1", type: "openai-compat", defaultMaxTokens: 2048 },
  "glm":      { baseUrl: "https://integrate.api.nvidia.com/v1", type: "openai-compat", defaultMaxTokens: 2048 },
  "minimax":  { baseUrl: "https://integrate.api.nvidia.com/v1", type: "openai-compat", defaultMaxTokens: 2048 },
  "llama":    { baseUrl: "https://integrate.api.nvidia.com/v1", type: "openai-compat", defaultMaxTokens: 4096 },
  "nemotron": { baseUrl: "https://integrate.api.nvidia.com/v1", type: "openai-compat", defaultMaxTokens: 4096 },
  "qwen":     { baseUrl: "https://integrate.api.nvidia.com/v1", type: "openai-compat", defaultMaxTokens: 4096 },
  // Native API providers (no custom base URL needed)
  "gemini":   { type: "google",    defaultMaxTokens: 4096 },
  "claude":   { type: "anthropic", defaultMaxTokens: 4096 },
};

interface ResolvedProvider {
  type: "openai-compat" | "anthropic" | "google";
  resolvedBaseUrl: string | undefined;
  maxTokens: number;
}

function resolveProvider(provider: Provider): ResolvedProvider {
  let resolvedBaseUrl = provider.baseUrl?.trim() || undefined;
  let type: "openai-compat" | "anthropic" | "google" = provider.type || "openai-compat";
  let maxTokens = provider.maxTokens ?? 1024;

  const model = provider.model?.toLowerCase() || "";
  const match = Object.keys(PROVIDER_REGISTRY).find((p) => model.includes(p));

  if (match) {
    const entry = PROVIDER_REGISTRY[match];
    if (!resolvedBaseUrl && entry.baseUrl) resolvedBaseUrl = entry.baseUrl;
    if (!provider.type || provider.type === "openai-compat") type = entry.type;
    if (!provider.maxTokens) maxTokens = entry.defaultMaxTokens;
  }

  return { type, resolvedBaseUrl, maxTokens };
}

// ── Non-streaming ask ─────────────────────────────────────────────────────────

export async function askProvider(
  provider: Provider,
  messages: Message[] | string,
  isFallback = false,
  abortSignal?: AbortSignal
): Promise<ProviderResponse> {
  try {
    return await withRetry(async () => {
      const normMessages: Message[] = typeof messages === "string"
        ? [{ role: "user", content: messages }]
        : messages;
      const { type, resolvedBaseUrl, maxTokens } = resolveProvider(provider);

      const controller = new AbortController();

      const onAbort = () => controller.abort();
      if (abortSignal) {
        abortSignal.addEventListener("abort", onAbort);
        if (abortSignal.aborted) controller.abort();
      }
      const timeout = setTimeout(() => controller.abort(), 60_000);

      try {
        if (type === "anthropic") {
          const breaker = getBreaker(provider, askAnthropic);
          return await breaker.fire(provider, normMessages, maxTokens, controller.signal);
        }
        if (type === "google") {
          const breaker = getBreaker(provider, askGoogle);
          return await breaker.fire(provider, normMessages, maxTokens, controller.signal);
        }
        // Default: openai-compat
        const breaker = getBreaker(provider, askOpenAI);
        return await breaker.fire(
          provider, normMessages, resolvedBaseUrl, maxTokens, controller.signal, isFallback,
          (p: any, msgs: any, fb: any) => askProvider(p, msgs, fb, abortSignal)
        );
      } finally {
        clearTimeout(timeout);
        if (abortSignal) {
          abortSignal.removeEventListener("abort", onAbort);
        }
      }
    }, {
      onRetry: (err, attempt) => {
        logger.warn({ attempt, provider: provider.name, error: err.message }, "Retry initiated");
      }
    });
  } catch (err: any) {
    if (!isFallback && (!abortSignal || !abortSignal.aborted)) {
      const fallback = getFallbackProvider(provider);
      if (fallback) return askProvider(fallback, messages, true, abortSignal);
    }
    throw err;
  }
}

// ── Streaming ask ─────────────────────────────────────────────────────────────

export async function askProviderStream(
  provider: Provider,
  messages: Message[] | string,
  onChunk: (chunk: string) => void,
  isFallback = false,
  abortSignal?: AbortSignal
): Promise<ProviderResponse> {
  try {
    return await withRetry(async () => {
      const normMessages: Message[] = typeof messages === "string"
        ? [{ role: "user", content: messages }]
        : messages;
      const { type, resolvedBaseUrl, maxTokens } = resolveProvider(provider);

      const controller = new AbortController();

      const onAbort = () => controller.abort();
      if (abortSignal) {
        abortSignal.addEventListener("abort", onAbort);
        if (abortSignal.aborted) controller.abort();
      }
      const timeout = setTimeout(() => controller.abort(), 60_000);

      try {
        if (type === "anthropic") {
          const breaker = getBreaker(provider, streamAnthropic);
          return await breaker.fire(provider, normMessages, maxTokens, controller.signal, onChunk);
        }
        if (type === "google") {
          const breaker = getBreaker(provider, streamGoogle);
          return await breaker.fire(provider, normMessages, maxTokens, controller.signal, onChunk);
        }
        // Default: openai-compat
        const breaker = getBreaker(provider, streamOpenAI);
        return await breaker.fire(
          provider, normMessages, resolvedBaseUrl, maxTokens, controller.signal, isFallback, onChunk,
          (p: any, msgs: any, chunk: any, fb: any) => askProviderStream(p, msgs, chunk, fb, abortSignal)
        );
      } finally {
        clearTimeout(timeout);
        if (abortSignal) {
          abortSignal.removeEventListener("abort", onAbort);
        }
      }
    }, {
      onRetry: (err, attempt) => {
        logger.warn({ attempt, provider: provider.name, error: err.message }, "Retry stream initiated");
      }
    });
  } catch (err: any) {
    if (!isFallback && (!abortSignal || !abortSignal.aborted)) {
      const fallback = getFallbackProvider(provider);
      if (fallback) return askProviderStream(fallback, messages, onChunk, true, abortSignal);
    }
    throw err;
  }
}