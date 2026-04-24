/**
 * LiteLLM Adapter — proxy gateway for 100+ LLM providers.
 *
 * LiteLLM is an OpenAI-compatible gateway that can route to any LLM provider.
 * Users self-host a LiteLLM proxy server and configure it with their API keys.
 * This adapter just points at that proxy.
 *
 * Config: LITELLM_API_KEY + LITELLM_BASE_URL (default: http://localhost:4000)
 */

import { OpenAICompatibleAdapter } from "./openaiCompatible.adapter.js";

export class LiteLLMAdapter extends OpenAICompatibleAdapter {
  readonly providerId = "litellm";

  constructor(apiKey: string, baseUrl: string = "http://localhost:4000") {
    // LiteLLM proxy exposes OpenAI-compatible endpoints at the root
    const normalizedUrl = baseUrl.replace(/\/+$/, "");
    super(apiKey, normalizedUrl);
  }

  protected override getDisplayName(): string {
    return "LiteLLM";
  }

  /**
   * LiteLLM supports stream_options for usage tracking.
   */
  protected override getStreamOptions(): Record<string, unknown> {
    return { stream_options: { include_usage: true } };
  }

  /**
   * LiteLLM model listing returns all models configured in the proxy.
   * No filtering needed — the proxy admin controls what's available.
   */
  protected override filterModels(models: Array<{ id: string }>): string[] {
    return models.map((m) => m.id).sort();
  }

  /**
   * LiteLLM may add custom metadata fields in the response.
   */
  protected override extractUsage(parsed: Record<string, unknown>): { prompt_tokens: number; completion_tokens: number } | null {
    // LiteLLM uses standard OpenAI usage format
    const usage = parsed.usage as { prompt_tokens?: number; completion_tokens?: number } | undefined;
    if (usage) {
      return {
        prompt_tokens: Math.max(0, Number(usage.prompt_tokens) || 0),
        completion_tokens: Math.max(0, Number(usage.completion_tokens) || 0),
      };
    }
    // Check for litellm-specific metadata
    const litellmMeta = parsed._litellm_params as { usage?: { prompt_tokens?: number; completion_tokens?: number } } | undefined;
    if (litellmMeta?.usage) {
      return {
        prompt_tokens: Math.max(0, Number(litellmMeta.usage.prompt_tokens) || 0),
        completion_tokens: Math.max(0, Number(litellmMeta.usage.completion_tokens) || 0),
      };
    }
    return null;
  }
}
