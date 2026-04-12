import type {
  IProviderAdapter,
  AdapterRequest,
  AdapterChunk,
  AdapterStreamResult,
  AdapterMessage,
  AdapterToolCall,
} from "./types.js";
import { createStreamResult } from "./types.js";
import { calculateCost } from "../lib/cost.js";
import { validateSafeUrl } from "../lib/ssrf.js";
import { getBreaker } from "../lib/breaker.js";
import logger from "../lib/logger.js";

const DEFAULT_TIMEOUT_MS = 60_000;

export class OpenAIAdapter implements IProviderAdapter {
  readonly providerId = "openai";
  private baseUrl: string;
  private apiKey: string;

  constructor(apiKey: string, baseUrl = "https://api.openai.com/v1") {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl.replace(/\/$/, "");
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

    const breaker = getBreaker({ name: this.providerId } as any, fetchChat);
    const res: Response = await breaker.fire();

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error((err as any)?.error?.message ?? `OpenAI API error: ${res.status}`);
    }

    const self = this;
    return createStreamResult(self.parseSSEStream(res, req.model));
  }

  private formatMessages(req: AdapterRequest): Record<string, unknown>[] {
    const msgs: Record<string, unknown>[] = [];
    if (req.system_prompt) {
      msgs.push({ role: "system", content: req.system_prompt });
    }
    for (const m of req.messages) {
      if (m.tool_calls) {
        msgs.push({
          role: m.role,
          content: typeof m.content === "string" ? m.content : null,
          tool_calls: m.tool_calls.map((tc) => ({
            id: tc.id,
            type: "function",
            function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
          })),
        });
      } else if (m.role === "tool") {
        msgs.push({
          role: "tool",
          tool_call_id: m.tool_call_id,
          content: typeof m.content === "string" ? m.content : JSON.stringify(m.content),
        });
      } else if (Array.isArray(m.content)) {
        msgs.push({
          role: m.role,
          content: m.content.map((block) => {
            if (block.type === "text") return { type: "text", text: block.text };
            if (block.type === "image_url") return { type: "image_url", image_url: { url: block.url } };
            if (block.type === "image_base64") {
              return { type: "image_url", image_url: { url: `data:${block.media_type};base64,${block.data}` } };
            }
            return { type: "text", text: String(block.text || "") };
          }),
        });
      } else {
        msgs.push({ role: m.role, content: m.content });
      }
    }
    return msgs;
  }

  private async *parseSSEStream(res: Response, model: string): AsyncGenerator<AdapterChunk> {
    if (!res.body) return;

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let pendingToolCalls = new Map<number, { id: string; name: string; args: string }>();

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        let newlineIdx: number;
        while ((newlineIdx = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, newlineIdx).trim();
          buffer = buffer.slice(newlineIdx + 1);

          if (!line.startsWith("data: ")) continue;
          const dataStr = line.slice(6).trim();
          if (dataStr === "[DONE]") {
            // Emit any pending tool calls
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

            if (delta?.content) {
              yield { type: "text", text: delta.content };
            }

            if (delta?.tool_calls) {
              for (const tc of delta.tool_calls) {
                const idx = tc.index ?? 0;
                if (!pendingToolCalls.has(idx)) {
                  pendingToolCalls.set(idx, { id: tc.id || "", name: tc.function?.name || "", args: "" });
                }
                const pending = pendingToolCalls.get(idx)!;
                if (tc.id) pending.id = tc.id;
                if (tc.function?.name) pending.name = tc.function.name;
                if (tc.function?.arguments) pending.args += tc.function.arguments;
              }
            }

            // Check for usage in final chunk
            if (parsed.usage) {
              yield {
                type: "usage",
                usage: {
                  prompt_tokens: parsed.usage.prompt_tokens || 0,
                  completion_tokens: parsed.usage.completion_tokens || 0,
                },
              };
            }
          } catch {
            // skip unparseable
          }
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
      const data: any = await res.json();
      return (data.data || [])
        .filter((m: any) => m.id.includes("gpt") || m.id.includes("o1") || m.id.includes("o3") || m.id.includes("o4"))
        .map((m: any) => m.id)
        .sort();
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
