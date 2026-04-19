import type {
  IProviderAdapter,
  AdapterRequest,
  AdapterChunk,
  AdapterStreamResult,
} from "./types.js";
import { createStreamResult } from "./types.js";
import { getBreaker } from "../lib/breaker.js";
import type { Provider } from "../lib/providers.js";
import { validateSafeUrl } from "../lib/ssrf.js";

const DEFAULT_TIMEOUT_MS = 60_000;

/**
 * Groq adapter — OpenAI-compatible with Groq's base URL.
 */
export class GroqAdapter implements IProviderAdapter {
  readonly providerId = "groq";
  private baseUrl = "https://api.groq.com/openai/v1";
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async generate(req: AdapterRequest): Promise<AdapterStreamResult> {
    await validateSafeUrl(this.baseUrl);

    const body: Record<string, unknown> = {
      model: req.model,
      stream: true,
      messages: this.formatMessages(req),
    };

    if (req.temperature !== undefined) body.temperature = req.temperature;
    if (req.max_tokens) body.max_tokens = req.max_tokens;
    if (req.top_p !== undefined) body.top_p = req.top_p;
    if (req.tools?.length) {
      body.tools = req.tools.map((t) => ({
        type: "function",
        function: { name: t.name, description: t.description, parameters: t.parameters },
      }));
      body.tool_choice = "auto";
    }

    const fetchChat = async () =>
      fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
      });

    const breaker = getBreaker({ name: this.providerId } as Provider, fetchChat);
    const res: Response = await breaker.fire();

    if (!res.ok) {
      const err = await res.json().catch(() => ({})) as Record<string, unknown>;
      const errObj = err as { error?: { message?: string } };
      throw new Error(errObj?.error?.message ?? `Groq API error: ${res.status}`);
    }

    return createStreamResult(this.parseSSE(res));
  }

  private formatMessages(req: AdapterRequest): Record<string, unknown>[] {
    const msgs: Record<string, unknown>[] = [];
    if (req.system_prompt) msgs.push({ role: "system", content: req.system_prompt });

    for (const m of req.messages) {
      if (m.role === "tool") {
        msgs.push({
          role: "tool",
          tool_call_id: m.tool_call_id,
          content: typeof m.content === "string" ? m.content : JSON.stringify(m.content),
        });
      } else if (m.tool_calls) {
        msgs.push({
          role: m.role,
          content: typeof m.content === "string" ? m.content : null,
          tool_calls: m.tool_calls.map((tc) => ({
            id: tc.id,
            type: "function",
            function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
          })),
        });
      } else {
        msgs.push({
          role: m.role,
          content: typeof m.content === "string" ? m.content : JSON.stringify(m.content),
        });
      }
    }
    return msgs;
  }

  private async *parseSSE(res: Response): AsyncGenerator<AdapterChunk> {
    if (!res.body) return;

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    const pendingToolCalls = new Map<number, { id: string; name: string; args: string }>();

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        let idx: number;
        while ((idx = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, idx).trim();
          buffer = buffer.slice(idx + 1);

          if (!line.startsWith("data: ")) continue;
          const dataStr = line.slice(6).trim();
          if (dataStr === "[DONE]") {
            for (const [, tc] of pendingToolCalls) {
              let args: Record<string, unknown> = {};
              try { args = JSON.parse(tc.args); } catch { /* empty */ }
              yield { type: "tool_call", tool_call: { id: tc.id, name: tc.name, arguments: args } };
            }
            continue;
          }

          try {
            const parsed = JSON.parse(dataStr);
            const delta = parsed.choices?.[0]?.delta;
            if (delta?.content) yield { type: "text", text: delta.content };

            if (delta?.tool_calls) {
              for (const tc of delta.tool_calls) {
                const i = tc.index ?? 0;
                if (!pendingToolCalls.has(i)) {
                  pendingToolCalls.set(i, { id: tc.id || "", name: tc.function?.name || "", args: "" });
                }
                const p = pendingToolCalls.get(i)!;
                if (tc.id) p.id = tc.id;
                if (tc.function?.name) p.name = tc.function.name;
                if (tc.function?.arguments) p.args += tc.function.arguments;
              }
            }

            if (parsed.x_groq?.usage || parsed.usage) {
              const u = parsed.x_groq?.usage || parsed.usage;
              yield {
                type: "usage",
                usage: { prompt_tokens: u.prompt_tokens || 0, completion_tokens: u.completion_tokens || 0 },
              };
            }
          } catch { /* skip */ }
        }
      }
    } finally {
      reader.releaseLock();
    }

    yield { type: "done" };
  }

  async listModels(): Promise<string[]> {
    try {
      const res = await fetch(`${this.baseUrl}/models`, {
        headers: { Authorization: `Bearer ${this.apiKey}` },
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) return [];
      const data = await res.json() as { data?: Array<{ id: string }> };
      return (data.data || []).map((m) => m.id).sort();
    } catch {
      return [];
    }
  }

  async isAvailable(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/models`, {
        headers: { Authorization: `Bearer ${this.apiKey}` },
        signal: AbortSignal.timeout(5000),
      });
      return res.ok;
    } catch {
      return false;
    }
  }
}
