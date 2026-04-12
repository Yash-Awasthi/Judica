import type {
  IProviderAdapter,
  AdapterRequest,
  AdapterChunk,
  AdapterStreamResult,
} from "./types.js";
import { createStreamResult } from "./types.js";
import { getBreaker } from "../lib/breaker.js";
import { validateSafeUrl } from "../lib/ssrf.js";

interface OllamaChunk {
  message?: { content?: string };
  response?: string;
  done: boolean;
  prompt_eval_count?: number;
  eval_count?: number;
}

/**
 * Ollama adapter — local models via Ollama's /api/chat endpoint.
 */
export class OllamaAdapter implements IProviderAdapter {
  readonly providerId = "ollama";
  private baseUrl: string;

  constructor(baseUrl = "http://localhost:11434") {
    this.baseUrl = baseUrl.replace(/\/$/, "");
  }

  async generate(req: AdapterRequest): Promise<AdapterStreamResult> {
    // Validate base URL against SSRF (blocks private IPs, localhost, cloud metadata).
    // NOTE: Ollama is typically on localhost which validateSafeUrl blocks.
    // For local-only deployments, operators should set ALLOW_PRIVATE_URLS=1 or
    // use the adapter only with explicitly trusted URLs.
    const localhostPatterns = [
      "http://localhost:",
      "http://127.0.0.1",
      "http://0.0.0.0",
      "http://[::1]",
      "http://::1",
    ];
    if (!localhostPatterns.some((p) => this.baseUrl.startsWith(p))) {
      await validateSafeUrl(this.baseUrl);
    }

    const model = req.model || "llama3.2";

    const messages: Record<string, unknown>[] = [];
    if (req.system_prompt) messages.push({ role: "system", content: req.system_prompt });

    for (const m of req.messages) {
      messages.push({
        role: m.role === "tool" ? "user" : m.role,
        content: typeof m.content === "string" ? m.content : JSON.stringify(m.content),
      });
    }

    const body: Record<string, unknown> = {
      model,
      messages,
      stream: true,
    };

    if (req.temperature !== undefined) {
      body.options = { ...(body.options as object || {}), temperature: req.temperature };
    }
    if (req.max_tokens) {
      body.options = { ...(body.options as object || {}), num_predict: req.max_tokens };
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 120000);

    try {
      const fetchChat = async () =>
        fetch(`${this.baseUrl}/api/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal: controller.signal,
        });

      const breaker = getBreaker({ name: this.providerId } as any, fetchChat);
      const res: Response = await breaker.fire();

      clearTimeout(timeout);

      if (!res.ok) {
        throw new Error(`Ollama error: ${res.status} ${res.statusText}`);
      }

      return createStreamResult(this.parseNDJSON(res));
    } catch (err) {
      clearTimeout(timeout);
      throw err;
    }
  }

  private async *parseNDJSON(res: Response): AsyncGenerator<AdapterChunk> {
    if (!res.body) return;

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let promptTokens = 0;
    let completionTokens = 0;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        let idx: number;
        while ((idx = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, idx).trim();
          buffer = buffer.slice(idx + 1);
          if (!line) continue;

          try {
            const parsed = JSON.parse(line) as OllamaChunk;

            const content = parsed.message?.content || parsed.response;
            if (content) {
              yield { type: "text", text: content };
            }

            if (parsed.done) {
              promptTokens = parsed.prompt_eval_count || 0;
              completionTokens = parsed.eval_count || 0;
            }
          } catch {
            // skip
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    yield {
      type: "usage",
      usage: { prompt_tokens: promptTokens, completion_tokens: completionTokens },
    };
    yield { type: "done" };
  }

  async listModels(): Promise<string[]> {
    try {
      const res = await fetch(`${this.baseUrl}/api/tags`, {
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) return [];
      const data: any = await res.json();
      return (data.models || []).map((m: any) => m.name).sort();
    } catch {
      return [];
    }
  }

  async isAvailable(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/api/tags`, {
        signal: AbortSignal.timeout(5000),
      });
      return res.ok;
    } catch {
      return false;
    }
  }
}
