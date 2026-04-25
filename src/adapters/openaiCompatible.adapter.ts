/**
 * Extracted base class for OpenAI-compatible adapters.
 * Deduplicates OpenAI/Groq/OpenRouter which share 95% identical code.
 *
 * Each adapter instance holds its own apiKey, scoped to its vendor.
 * Keys are set at construction time from provider-specific env vars
 * (e.g. OPENAI_API_KEY for OpenAI, GROQ_API_KEY for Groq).
 * The base URL is also per-instance, so keys are never sent cross-vendor.
 */
import type {
  IProviderAdapter,
  AdapterRequest,
  AdapterChunk,
  AdapterStreamResult,
} from "./types.js";
import { createStreamResult } from "./types.js";
import { validateSafeUrl } from "../lib/ssrf.js";
import { getBreaker } from "../lib/breaker.js";
import logger from "../lib/logger.js";

const DEFAULT_TIMEOUT_MS = 60_000;

export abstract class OpenAICompatibleAdapter implements IProviderAdapter {
  abstract readonly providerId: string;
  protected baseUrl: string;
  protected apiKey: string;
  // Store the original base URL origin to detect if requests
  // would leak the key to a different host.
  private readonly _originHost: string;

  constructor(apiKey: string, baseUrl: string) {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this._originHost = new URL(this.baseUrl).host;
  }

  /**
   * Verify that the request URL matches the adapter's configured origin.
   * Prevents API key from being sent to a different vendor if baseUrl is mutated.
   */
  private assertSameOrigin(url: string): void {
    const requestHost = new URL(url).host;
    if (requestHost !== this._originHost) {
      throw new Error(
        `API key leak prevented: adapter ${this.providerId} configured for ${this._originHost} but request targets ${requestHost}`
      );
    }
  }

  /** Override to customize the display name in error messages. Defaults to providerId. */
  protected getDisplayName(): string {
    return this.providerId;
  }

  /** Override to add extra headers (e.g. OpenRouter's HTTP-Referer). */
  protected getExtraHeaders(): Record<string, string> {
    return {};
  }

  /** Override to add extra body fields (e.g. OpenRouter's transforms/route). */
  protected getExtraBody(_req: AdapterRequest): Record<string, unknown> {
    return {};
  }

  /** Override to customize the streaming body (e.g. OpenAI's stream_options). */
  protected getStreamOptions(): Record<string, unknown> {
    return {};
  }

  /** Override to extract usage from provider-specific fields. */
  protected extractUsage(parsed: Record<string, unknown>): { prompt_tokens: number; completion_tokens: number } | null {
    const usage = parsed.usage as { prompt_tokens?: number; completion_tokens?: number } | undefined;
    if (usage) {
      return {
        prompt_tokens: usage.prompt_tokens || 0,
        completion_tokens: usage.completion_tokens || 0,
      };
    }
    return null;
  }

  /** Override to customize model filtering in listModels. */
  protected filterModels(models: Array<{ id: string }>): string[] {
    return models.map((m) => m.id).sort();
  }

  async generate(req: AdapterRequest): Promise<AdapterStreamResult> {
    await validateSafeUrl(this.baseUrl);
    // Ensure key isn't sent to a different host
    this.assertSameOrigin(`${this.baseUrl}/chat/completions`);

    const body: Record<string, unknown> = {
      model: req.model,
      stream: true,
      ...this.getStreamOptions(),
      messages: this.formatMessages(req),
      ...this.getExtraBody(req),
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
          ...this.getExtraHeaders(),
        },
        body: JSON.stringify(body),
        redirect: "error",
        signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
      });

    const breaker = getBreaker({ name: this.providerId } as { name: string }, fetchChat);
    const res: Response = await breaker.fire();

    if (!res.ok) {
      const err = await res.json().catch(() => ({})) as Record<string, unknown>;
      const errObj = err as { error?: { message?: string } };
      throw new Error(errObj?.error?.message ?? `${this.getDisplayName()} API error: ${res.status}`);
    }

    return createStreamResult(this.parseSSEStream(res));
  }

  protected formatMessages(req: AdapterRequest): Record<string, unknown>[] {
    const msgs: Record<string, unknown>[] = [];
    if (req.system_prompt) msgs.push({ role: "system", content: req.system_prompt });

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
        msgs.push({
          role: m.role,
          content: typeof m.content === "string" ? m.content : JSON.stringify(m.content),
        });
      }
    }
    return msgs;
  }

  protected async *parseSSEStream(res: Response): AsyncGenerator<AdapterChunk> {
    if (!res.body) return;

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    const pendingToolCalls = new Map<number, { id: string; name: string; args: string }>();

    let lastUsage: { prompt_tokens: number; completion_tokens: number } | null = null;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        let idx: number;
        // Handle both \r\n (Windows/proxy) and \n line endings
        while ((idx = buffer.search(/\r?\n/)) >= 0) {
          const line = buffer.slice(0, idx).trim();
          // Skip past \r\n or \n
          const lineEndLen = buffer[idx] === "\r" ? 2 : 1;
          buffer = buffer.slice(idx + lineEndLen);

          if (!line.startsWith("data: ")) continue;
          const dataStr = line.slice(6).trim();
          if (dataStr === "[DONE]") {
            for (const [, tc] of pendingToolCalls) {
              let args: Record<string, unknown> = {};
              try { args = JSON.parse(tc.args); } catch { logger.warn({ toolName: tc.name }, "Failed to parse tool call JSON arguments"); }
              yield { type: "tool_call", tool_call: { id: tc.id, name: tc.name, arguments: args } };
            }
            // Emit usage exactly once at stream end (not per-chunk)
            if (lastUsage) {
              yield { type: "usage", usage: lastUsage };
            }
            continue;
          }

          try {
            const parsed = JSON.parse(dataStr);
            const delta = parsed.choices?.[0]?.delta;
            if (delta?.content) yield { type: "text", text: delta.content };

            if (delta?.tool_calls) {
              for (const tc of delta.tool_calls) {
                // Use tc.index if present; generate sequential index if missing
                const i = tc.index ?? pendingToolCalls.size;
                if (!pendingToolCalls.has(i)) {
                  pendingToolCalls.set(i, { id: tc.id || "", name: tc.function?.name || "", args: "" });
                }
                const p = pendingToolCalls.get(i)!;
                if (tc.id) p.id = tc.id;
                if (tc.function?.name) p.name = tc.function.name;
                if (tc.function?.arguments) p.args += tc.function.arguments;
              }
            }

            // Accumulate usage — only emit once at [DONE]
            const usage = this.extractUsage(parsed);
            if (usage) {
              lastUsage = usage;
            }
          } catch { /* skip malformed chunks */ }
        }
      }
    } finally {
      reader.releaseLock();
    }

    yield { type: "done" };
  }

  async listModels(): Promise<string[]> {
    // R3-11: generate() calls validateSafeUrl but listModels/isAvailable did not.
    // An attacker could use these methods to probe internal services via a crafted baseUrl.
    try {
      await validateSafeUrl(this.baseUrl);
    } catch {
      return [];
    }
    try {
      const res = await fetch(`${this.baseUrl}/models`, {
        headers: { Authorization: `Bearer ${this.apiKey}`, ...this.getExtraHeaders() },
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) return [];
      const data = await res.json() as { data?: Array<{ id: string }> };
      return this.filterModels(data.data || []);
    } catch {
      return [];
    }
  }

  async isAvailable(): Promise<boolean> {
    // R3-11: Same SSRF guard — validateSafeUrl before fetching.
    try {
      await validateSafeUrl(this.baseUrl);
    } catch {
      return false;
    }
    try {
      const res = await fetch(`${this.baseUrl}/models`, {
        headers: { Authorization: `Bearer ${this.apiKey}`, ...this.getExtraHeaders() },
        signal: AbortSignal.timeout(5000),
      });
      return res.ok;
    } catch {
      return false;
    }
  }
}
