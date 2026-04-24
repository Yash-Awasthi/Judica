/**
 * vLLM Adapter — self-hosted GPU inference server.
 *
 * vLLM exposes an OpenAI-compatible API at /v1.
 * Users run a vLLM server locally or on a GPU cluster.
 *
 * Config: VLLM_BASE_URL (default: http://localhost:8000/v1)
 * Optional: VLLM_API_KEY (if vLLM server has auth enabled)
 */

import { OpenAICompatibleAdapter } from "./openaiCompatible.adapter.js";

export class VLLMAdapter extends OpenAICompatibleAdapter {
  readonly providerId = "vllm";

  constructor(baseUrl: string = "http://localhost:8000/v1", apiKey: string = "dummy") {
    const normalizedUrl = baseUrl.replace(/\/+$/, "");
    super(apiKey, normalizedUrl);
  }

  protected override getDisplayName(): string {
    return "vLLM";
  }

  /**
   * vLLM supports OpenAI-style stream options.
   */
  protected override getStreamOptions(): Record<string, unknown> {
    return { stream_options: { include_usage: true } };
  }

  /**
   * vLLM model listing returns all loaded models.
   */
  protected override filterModels(models: Array<{ id: string }>): string[] {
    return models.map((m) => m.id).sort();
  }

  /**
   * vLLM uses standard OpenAI usage format.
   */
  protected override extractUsage(parsed: Record<string, unknown>): { prompt_tokens: number; completion_tokens: number } | null {
    const usage = parsed.usage as { prompt_tokens?: number; completion_tokens?: number } | undefined;
    if (usage) {
      return {
        prompt_tokens: Math.max(0, Number(usage.prompt_tokens) || 0),
        completion_tokens: Math.max(0, Number(usage.completion_tokens) || 0),
      };
    }
    return null;
  }
}
