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
const MAX_BUFFER_SIZE = 1_048_576; // 1 MB

export class AnthropicAdapter implements IProviderAdapter {
  readonly providerId = "anthropic";
  private baseUrl: string;
  private apiKey: string;

  constructor(apiKey: string, baseUrl = "https://api.anthropic.com") {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl.replace(/\/$/, "");
  }

  async generate(req: AdapterRequest): Promise<AdapterStreamResult> {
    await validateSafeUrl(this.baseUrl);

    const body: Record<string, unknown> = {
      model: req.model,
      max_tokens: req.max_tokens || 4096,
      stream: true,
      messages: await this.formatMessages(req),
    };

    if (req.system_prompt) body.system = req.system_prompt;
    if (req.temperature !== undefined) body.temperature = req.temperature;
    if (req.top_p !== undefined) body.top_p = req.top_p;
    if (req.tools?.length) {
      body.tools = req.tools.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.parameters,
      }));
    }

    const fetchMessages = async () =>
      fetch(`${this.baseUrl}/v1/messages`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": this.apiKey,
          // P1-07: Updated to 2023-10-01 for parallel tools and cache_control support
          "anthropic-version": "2023-10-01",
        },
        body: JSON.stringify(body),
        redirect: "error",
        signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
      });

    // P3-04: Use minimal shape instead of legacy Provider type
    const breaker = getBreaker({ name: this.providerId } as { name: string }, fetchMessages);
    const res: Response = await breaker.fire();

    if (!res.ok) {
      const err = await res.json().catch(() => ({})) as Record<string, unknown>;
      const errObj = err as { error?: { message?: string } };
      throw new Error(errObj?.error?.message ?? `Anthropic API error: ${res.status}`);
    }

    const self = this;
    return createStreamResult(self.parseStream(res));
  }

  private async formatMessages(req: AdapterRequest): Promise<Record<string, unknown>[]> {
    const msgs: Record<string, unknown>[] = [];

    for (const m of req.messages) {
      if (m.role === "system") {
        // Anthropic doesn't support system role in messages — skip (handled via body.system)
        continue;
      }

      if (m.role === "tool") {
        // P7-26: Validate tool_call_id exists — Anthropic rejects requests without it
        if (!m.tool_call_id) {
          logger.warn("Skipping tool result with missing tool_call_id");
          continue;
        }
        // Anthropic expects tool results as user messages with tool_result content
        msgs.push({
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: m.tool_call_id,
              content: typeof m.content === "string" ? m.content : JSON.stringify(m.content),
            },
          ],
        });
        continue;
      }

      if (m.tool_calls) {
        // Assistant message with tool use
        const content: Record<string, unknown>[] = [];
        if (typeof m.content === "string" && m.content) {
          content.push({ type: "text", text: m.content });
        }
        for (const tc of m.tool_calls) {
          content.push({ type: "tool_use", id: tc.id, name: tc.name, input: tc.arguments });
        }
        msgs.push({ role: "assistant", content });
        continue;
      }

      if (Array.isArray(m.content)) {
        const content: Record<string, unknown>[] = [];
        for (const block of m.content) {
          if (block.type === "text") {
            content.push({ type: "text", text: block.text });
          } else if (block.type === "image_base64") {
            content.push({
              type: "image",
              source: { type: "base64", media_type: block.media_type, data: block.data },
            });
          } else if (block.type === "image_url" && block.url) {
            // P1-02: Anthropic doesn't natively support image URLs; use text placeholder
            content.push({ type: "text", text: `[Image: ${block.url}]` });
          } else {
            content.push({ type: "text", text: String(block.text || "") });
          }
        }
        msgs.push({ role: m.role, content });
      } else {
        msgs.push({ role: m.role, content: m.content });
      }
    }

    return msgs;
  }

  private async *parseStream(res: Response): AsyncGenerator<AdapterChunk> {
    if (!res.body) return;

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    // P1-01: Use a Map keyed by content block index to support parallel tool_use
    // without clobbering. Previous scalar variables lost data when Anthropic
    // streamed multiple tool_use blocks concurrently.
    const pendingTools = new Map<number, { id: string; name: string; args: string }>();
    let currentBlockIndex = 0;
    // P3-03: Accumulate usage across message_start (input) and message_delta (output)
    // chunks instead of emitting separately, which caused downstream code to
    // overwrite input_tokens with 0 from the second usage event.
    let totalPromptTokens = 0;
    let totalCompletionTokens = 0;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        if (buffer.length > MAX_BUFFER_SIZE) {
          logger.warn("Anthropic stream buffer exceeded MAX_BUFFER_SIZE; aborting read");
          break;
        }
        let newlineIdx: number;
        while ((newlineIdx = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, newlineIdx).trim();
          buffer = buffer.slice(newlineIdx + 1);

          if (!line.startsWith("data: ")) continue;
          const dataStr = line.slice(6).trim();
          if (!dataStr) continue;

          try {
            const parsed = JSON.parse(dataStr);

            switch (parsed.type) {
              case "content_block_start":
                currentBlockIndex = parsed.index ?? currentBlockIndex;
                if (parsed.content_block?.type === "tool_use") {
                  pendingTools.set(currentBlockIndex, {
                    id: parsed.content_block.id,
                    name: parsed.content_block.name,
                    args: "",
                  });
                }
                break;

              case "content_block_delta":
                currentBlockIndex = parsed.index ?? currentBlockIndex;
                if (parsed.delta?.type === "text_delta" && parsed.delta.text) {
                  yield { type: "text", text: parsed.delta.text };
                }
                if (parsed.delta?.type === "input_json_delta" && parsed.delta.partial_json) {
                  const tool = pendingTools.get(currentBlockIndex);
                  if (tool) tool.args += parsed.delta.partial_json;
                }
                break;

              case "content_block_stop": {
                currentBlockIndex = parsed.index ?? currentBlockIndex;
                const tool = pendingTools.get(currentBlockIndex);
                if (tool) {
                  let args: Record<string, unknown> = {};
                  try { args = JSON.parse(tool.args); } catch (e) { logger.debug?.({ err: e }, 'Failed to parse tool call args'); }
                  yield {
                    type: "tool_call",
                    tool_call: { id: tool.id, name: tool.name, arguments: args },
                  };
                  pendingTools.delete(currentBlockIndex);
                }
                break;
              }

              case "message_delta":
                if (parsed.usage) {
                  totalCompletionTokens += parsed.usage.output_tokens || 0;
                }
                break;

              case "message_start":
                if (parsed.message?.usage) {
                  totalPromptTokens += parsed.message.usage.input_tokens || 0;
                }
                break;
            }
          } catch {
            // skip
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    // Emit accumulated usage once at stream end
    yield {
      type: "usage",
      usage: { prompt_tokens: totalPromptTokens, completion_tokens: totalCompletionTokens },
    };
    yield { type: "done" };
  }

  async listModels(): Promise<string[]> {
    // P3-06: Try the real /v1/models endpoint first, fall back to known models.
    // Anthropic's models API requires beta header and may not be available for all plans.
    try {
      await validateSafeUrl(this.baseUrl);
      const res = await fetch(`${this.baseUrl}/v1/models`, {
        headers: {
          "x-api-key": this.apiKey,
          "anthropic-version": "2023-10-01",
        },
        signal: AbortSignal.timeout(10_000),
      });
      if (res.ok) {
        const data = await res.json() as { data?: Array<{ id: string }> };
        if (data.data?.length) {
          return data.data.map((m) => m.id).sort();
        }
      }
    } catch {
      // Fall through to static list
    }

    return [
      "claude-opus-4-20250514",
      "claude-sonnet-4-20250514",
      "claude-3-5-sonnet-20241022",
      "claude-3-5-haiku-20241022",
      "claude-3-opus-20240229",
      "claude-3-haiku-20240307",
    ];
  }

  // P7-25: Validate key format — check prefix
  async isAvailable(): Promise<boolean> {
    if (typeof this.apiKey !== "string") return false;
    if (!this.apiKey.startsWith("sk-")) return false;
    if (this.apiKey.length < 10) return false;
    return true;
  }
}
