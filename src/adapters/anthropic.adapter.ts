import type {
  IProviderAdapter,
  AdapterRequest,
  AdapterChunk,
  AdapterStreamResult,
} from "./types.js";
import { createStreamResult } from "./types.js";
import { validateSafeUrl } from "../lib/ssrf.js";
import { getBreaker } from "../lib/breaker.js";
import type { Provider } from "../lib/providers.js";
import logger from "../lib/logger.js";

const DEFAULT_TIMEOUT_MS = 60_000;

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
      messages: this.formatMessages(req),
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
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
      });

    const breaker = getBreaker({ name: this.providerId } as Provider, fetchMessages);
    const res: Response = await breaker.fire();

    if (!res.ok) {
      const err = await res.json().catch(() => ({})) as Record<string, unknown>;
      const errObj = err as { error?: { message?: string } };
      throw new Error(errObj?.error?.message ?? `Anthropic API error: ${res.status}`);
    }

    const self = this;
    return createStreamResult(self.parseStream(res));
  }

  private formatMessages(req: AdapterRequest): Record<string, unknown>[] {
    const msgs: Record<string, unknown>[] = [];

    for (const m of req.messages) {
      if (m.role === "system") {
        // Anthropic doesn't support system role in messages — skip (handled via body.system)
        continue;
      }

      if (m.role === "tool") {
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
        const content = m.content.map((block) => {
          if (block.type === "text") return { type: "text", text: block.text };
          if (block.type === "image_base64") {
            return {
              type: "image",
              source: { type: "base64", media_type: block.media_type, data: block.data },
            };
          }
          if (block.type === "image_url") {
            return { type: "text", text: `[Image: ${block.url}]` };
          }
          return { type: "text", text: String(block.text || "") };
        });
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
    let currentToolId = "";
    let currentToolName = "";
    let currentToolArgs = "";

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
          if (!dataStr) continue;

          try {
            const parsed = JSON.parse(dataStr);

            switch (parsed.type) {
              case "content_block_start":
                if (parsed.content_block?.type === "tool_use") {
                  currentToolId = parsed.content_block.id;
                  currentToolName = parsed.content_block.name;
                  currentToolArgs = "";
                }
                break;

              case "content_block_delta":
                if (parsed.delta?.type === "text_delta" && parsed.delta.text) {
                  yield { type: "text", text: parsed.delta.text };
                }
                if (parsed.delta?.type === "input_json_delta" && parsed.delta.partial_json) {
                  currentToolArgs += parsed.delta.partial_json;
                }
                break;

              case "content_block_stop":
                if (currentToolId) {
                  let args: Record<string, unknown> = {};
                  try { args = JSON.parse(currentToolArgs); } catch (e) { logger.debug?.({ err: e }, 'Failed to parse tool call args'); }
                  yield {
                    type: "tool_call",
                    tool_call: { id: currentToolId, name: currentToolName, arguments: args },
                  };
                  currentToolId = "";
                  currentToolName = "";
                  currentToolArgs = "";
                }
                break;

              case "message_delta":
                if (parsed.usage) {
                  yield {
                    type: "usage",
                    usage: {
                      prompt_tokens: 0, // Anthropic sends input_tokens in message_start
                      completion_tokens: parsed.usage.output_tokens || 0,
                    },
                  };
                }
                break;

              case "message_start":
                if (parsed.message?.usage) {
                  yield {
                    type: "usage",
                    usage: {
                      prompt_tokens: parsed.message.usage.input_tokens || 0,
                      completion_tokens: 0,
                    },
                  };
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

    yield { type: "done" };
  }

  async listModels(): Promise<string[]> {
    // Anthropic doesn't have a list models endpoint
    return [
      "claude-opus-4-20250514",
      "claude-sonnet-4-20250514",
      "claude-3-5-sonnet-20241022",
      "claude-3-5-haiku-20241022",
      "claude-3-opus-20240229",
      "claude-3-haiku-20240307",
    ];
  }

  async isAvailable(): Promise<boolean> {
    return typeof this.apiKey === "string" && this.apiKey.startsWith("sk-ant-");
  }
}
