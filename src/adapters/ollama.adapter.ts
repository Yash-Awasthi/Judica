import type {
  IProviderAdapter,
  AdapterRequest,
  AdapterChunk,
  AdapterStreamResult,
} from "./types.js";
import { createStreamResult } from "./types.js";
import { getBreaker } from "../lib/breaker.js";
import { validateSafeUrl } from "../lib/ssrf.js";

// P3-07: Configurable timeout for local model inference (default 120s)
const OLLAMA_TIMEOUT_MS = parseInt(process.env.OLLAMA_TIMEOUT_MS || "120000", 10);

interface OllamaChunk {
  message?: { content?: string; tool_calls?: Array<{ function: { name: string; arguments: Record<string, unknown> } }> };
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
    // P0-22: Proper localhost check via URL parsing instead of string prefix match
    const parsedUrl = new URL(this.baseUrl);
    const hostname = parsedUrl.hostname.toLowerCase().replace(/^\[|\]$/g, "");
    const isLocalhost = hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1" || hostname === "0.0.0.0";

    if (!isLocalhost) {
      await validateSafeUrl(this.baseUrl);
    }

    const model = req.model || "llama3.2";

    const messages: Record<string, unknown>[] = [];
    if (req.system_prompt) messages.push({ role: "system", content: req.system_prompt });

    for (const m of req.messages) {
      // P7-33: Ollama only accepts "system", "user", "assistant" roles.
      // Map "tool" to "user" (Ollama has no native tool-result role).
      const role = m.role === "tool" ? "user" : m.role;
      messages.push({
        role,
        content: typeof m.content === "string" ? m.content : JSON.stringify(m.content),
      });
    }

    const body: Record<string, unknown> = {
      model,
      messages,
      stream: true,
    };

    // P1-03: Send tools in body for Ollama tool call support
    if (req.tools?.length) {
      body.tools = req.tools.map((t) => ({
        type: "function",
        function: { name: t.name, description: t.description, parameters: t.parameters },
      }));
    }

    if (req.temperature !== undefined) {
      body.options = { ...(body.options as object || {}), temperature: req.temperature };
    }
    if (req.max_tokens) {
      body.options = { ...(body.options as object || {}), num_predict: req.max_tokens };
    }

    // P7-32: Use AbortSignal.timeout() instead of manual AbortController + setTimeout.
    // The previous approach conflicted with the circuit breaker's own timeout logic,
    // causing premature aborts when the breaker retried.
    const fetchChat = async () =>
      fetch(`${this.baseUrl}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(OLLAMA_TIMEOUT_MS),
        redirect: "error",
      });

    const breaker = getBreaker({ name: this.providerId } as { name: string }, fetchChat);
    const res: Response = await breaker.fire();

    if (!res.ok) {
      throw new Error(`Ollama error: ${res.status}`);
    }

    return createStreamResult(this.parseNDJSON(res));
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

            // P1-03: Parse tool calls from message.tool_calls
            if (parsed.message?.tool_calls) {
              for (const tc of parsed.message.tool_calls) {
                yield {
                  type: "tool_call",
                  tool_call: {
                    id: `ollama-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                    name: tc.function.name,
                    arguments: tc.function.arguments || {},
                  },
                };
              }
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
      const data = await res.json() as { models?: Array<{ name: string }> };
      return (data.models || []).map((m) => m.name).sort();
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
