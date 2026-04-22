import logger from "../../logger.js";
import { BaseProvider } from "../baseProvider.js";
import type { ProviderConfig, ProviderResponse, Message } from "../types.js";
import { validateSafeUrl } from "../../ssrf.js";

interface OllamaResponse {
  response?: string;
  done: boolean;
  prompt_eval_count?: number;
  eval_count?: number;
}

export class OllamaProvider extends BaseProvider {
  private baseUrl: string;

  constructor(config: ProviderConfig) {
    super(config);
    this.baseUrl = config.baseUrl || "http://localhost:11434";
  }

  private async validateBaseUrl(url: string): Promise<void> {
    // Allow localhost for local Ollama instances
    const parsed = new URL(url);
    if (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1") return;
    await validateSafeUrl(url);
  }

  async call({ prompt, messages, signal, isFallback: _isFallback, onChunk }: {
    messages: Message[];
    prompt?: string;
    signal?: AbortSignal;
    isFallback?: boolean;
    onChunk?: (chunk: string) => void;
  }): Promise<ProviderResponse> {
    const rawContent = prompt || messages[messages.length - 1].content;
    const finalPrompt = typeof rawContent === "string" ? rawContent : JSON.stringify(rawContent);
    const model = this.config.model || "llama3";

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60000);
    const onAbort = () => controller.abort();
    if (signal) {
      if (signal.aborted) controller.abort();
      else signal.addEventListener("abort", onAbort, { once: true });
    }

    try {

      await this.validateBaseUrl(this.baseUrl);

      const response = await this.protectedFetch(`${this.baseUrl}/api/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          prompt: finalPrompt,
          system: this.config.systemPrompt,
          stream: !!onChunk
        }),
        signal: controller.signal
      });

      if (!response.ok) {
        clearTimeout(timeout);
        throw new Error(`Ollama error: ${response.status} ${response.statusText}`);
      }

      if (onChunk && response.body) {
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let text = "";
        let buffer = "";
        let streamPromptTokens = 0;
        let streamCompletionTokens = 0;

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          // P41-05: Cap buffer to prevent unbounded memory from malicious streams
          if (buffer.length > 10_000_000) {
            throw new Error("Ollama stream buffer exceeded maximum size");
          }
          let newlineIndex;
          while ((newlineIndex = buffer.indexOf('\n')) >= 0) {
            const line = buffer.slice(0, newlineIndex).trim();
            buffer = buffer.slice(newlineIndex + 1);

            if (!line) continue;

            try {
              const parsed = JSON.parse(line) as OllamaResponse;
              if (parsed.response) {
                text += parsed.response;
                onChunk(parsed.response);
              }
              // P41-06: Use nullish coalescing to distinguish 0 from missing
              if (parsed.done) {
                streamPromptTokens = parsed.prompt_eval_count ?? 0;
                streamCompletionTokens = parsed.eval_count ?? 0;
              }
            } catch { /* ignore unparseable chunk */ }
          }
        }

        clearTimeout(timeout);

        // Use actual counts from stream if available, otherwise estimate
        const promptTokens = streamPromptTokens || Math.ceil(finalPrompt.length / 4);
        const completionTokens = streamCompletionTokens || Math.ceil(text.length / 4);
        return {
          text: text.trim(),
          usage: {
            promptTokens,
            completionTokens,
            totalTokens: promptTokens + completionTokens,
          },
          cost: 0 // Local is free
        };
      }

      const data = await response.json() as OllamaResponse;
      clearTimeout(timeout);
      
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
      signal?.removeEventListener("abort", onAbort);
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
