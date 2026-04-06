import logger from "../../logger.js";
import { BaseProvider } from "../baseProvider.js";
import { ProviderConfig, ProviderResponse, Message } from "../types.js";

interface OllamaResponse {
  response?: string;
  done: boolean;
  prompt_eval_count?: number;
  eval_count?: number;
}

/**
 * Ollama local provider.
 * Implements BaseProvider for uniform interface.
 */
export class OllamaProvider extends BaseProvider {
  private baseUrl: string;

  constructor(config: ProviderConfig) {
    super(config);
    this.baseUrl = config.baseUrl || "http://localhost:11434";
  }

  async call({ prompt, messages, signal }: {
    messages: Message[];
    prompt?: string;
    signal?: AbortSignal;
  }): Promise<ProviderResponse> {
    const finalPrompt = prompt || messages[messages.length - 1].content;
    const model = this.config.model || "llama3";

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 60000);

      if (signal) {
        if (signal.aborted) controller.abort();
        signal.addEventListener("abort", () => controller.abort());
      }

      const response = await fetch(`${this.baseUrl}/api/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          prompt: finalPrompt,
          system: this.config.systemPrompt,
          stream: false
        }),
        signal: controller.signal
      });

      clearTimeout(timeout);

      if (!response.ok) {
        throw new Error(`Ollama error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json() as OllamaResponse;
      
      return {
        text: data.response || "",
        usage: {
          promptTokens: data.prompt_eval_count || Math.ceil(finalPrompt.length / 4),
          completionTokens: data.eval_count || Math.ceil((data.response || "").length / 4),
          totalTokens: (data.prompt_eval_count || 0) + (data.eval_count || 0) || Math.ceil((finalPrompt.length + (data.response || "").length) / 4)
        },
        cost: 0 // Local is free
      };
    } catch (err) {
      if ((err as Error).name === "AbortError" || signal?.aborted) {
        logger.warn({ model }, "Ollama call aborted");
        throw err;
      }
      logger.error({ err, model }, "Ollama call failed");
      throw err;
    }
  }

  async healthCheck(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/api/version`);
      return res.ok;
    } catch {
      return false;
    }
  }
}
