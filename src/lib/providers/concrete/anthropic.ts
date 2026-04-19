import logger from "../../logger.js";
import { BaseProvider } from "../baseProvider.js";
import { ProviderConfig, ProviderResponse, Message } from "../types.js";
import { calculateCost } from "../../cost.js";
import { validateSafeUrl } from "../../ssrf.js";
import { getToolDefinitions, callTool } from "../../tools/index.js";

export class AnthropicProvider extends BaseProvider {
  private defaultBaseUrl = "https://api.anthropic.com/v1/messages";

  constructor(config: ProviderConfig) {
    super(config);
  }

  async call({ messages, signal, maxTokens, isFallback, onChunk, _depth = 0 }: {
    messages: Message[];
    signal?: AbortSignal;
    maxTokens?: number;
    isFallback?: boolean;
    onChunk?: (chunk: string) => void;
    _depth?: number;
  }): Promise<ProviderResponse> {
    if (_depth >= 10) {
      throw new Error("Tool call depth limit exceeded (max 10 recursive rounds)");
    }
    const url = this.config.baseUrl || this.defaultBaseUrl;
    await validateSafeUrl(url);

    const controller = new AbortController();
    if (signal) {
      if (signal.aborted) controller.abort();
      signal.addEventListener("abort", () => controller.abort());
    }

    try {
      const res = await this.protectedFetch(url, {
        method: "POST",
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          "x-api-key": this.config.apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: this.config.model || "claude-3-5-sonnet-20241022",
          max_tokens: maxTokens || this.config.maxTokens || 4096,
          stream: !!onChunk,
          ...(this.config.systemPrompt ? { system: this.config.systemPrompt } : {}),
          messages: messages.map(m => ({
            role: m.role === "system" ? "user" : (m.role === "tool" ? "user" : m.role),
            content: m.content
          })),
          tools: getToolDefinitions(this.config.tools || []).map(t => ({
            name: t.name,
            description: t.description,
            input_schema: t.parameters
          }))
        }),
      });

      if (!res.ok) {
        let errorData: any = {};
        try { errorData = await res.json(); } catch { /* ignore */ }
        throw new Error(errorData?.error?.message ?? `Anthropic API error: ${res.status}`);
      }

      if (onChunk && res.body) {
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let text = "";
        let buffer = "";
        let streamInputTokens = 0;
        let streamOutputTokens = 0;

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          let newlineIndex;
          while ((newlineIndex = buffer.indexOf('\n')) >= 0) {
            const line = buffer.slice(0, newlineIndex).trim();
            buffer = buffer.slice(newlineIndex + 1);

            if (line.startsWith("data: ")) {
              const dataStr = line.slice(6).trim();
              if (!dataStr) continue;

              try {
                const parsed = JSON.parse(dataStr);
                if (parsed.type === "content_block_delta" && parsed.delta?.text) {
                  const content = parsed.delta.text;
                  text += content;
                  onChunk(content);
                }
                // Capture usage from message_start and message_delta events
                if (parsed.type === "message_start" && parsed.message?.usage) {
                  streamInputTokens = parsed.message.usage.input_tokens || 0;
                }
                if (parsed.type === "message_delta" && parsed.usage) {
                  streamOutputTokens = parsed.usage.output_tokens || 0;
                }
              } catch { /* ignore unparseable SSE chunk */ }
            }
          }
        }

        const estimatedCompletion = Math.ceil(text.length / 4);
        const usage = {
          promptTokens: streamInputTokens,
          completionTokens: streamOutputTokens || estimatedCompletion,
          totalTokens: streamInputTokens + (streamOutputTokens || estimatedCompletion),
        };

        const cost = calculateCost(
          "anthropic",
          this.config.model,
          usage.promptTokens,
          usage.completionTokens
        );

        return { text: text.trim(), usage, cost, raw: { stream: true } };
      }

      const data = await res.json();
      const content = data.content || [];
      const toolCalls = content.filter((c: any) => c.type === "tool_use");

      if (toolCalls.length > 0) {
        logger.info({ 
          provider: this.name, 
          toolCount: toolCalls.length 
        }, "Processing Anthropic tool calls");

        const nextMessages: Message[] = [...messages, { 
          role: "assistant", 
          content: content 
        }];

        for (const tc of toolCalls) {
          const result = await callTool({ 
            id: tc.id, 
            name: tc.name, 
            arguments: tc.input 
          });
          
          const safeResult = `[UNTRUSTED TOOL OUTPUT]\n${result.result || result}\n[/UNTRUSTED TOOL OUTPUT]`;
          
          nextMessages.push({
            role: "user",
            content: [
              {
                type: "tool_result",
                tool_use_id: tc.id,
                content: safeResult
              }
            ]
          } as any);
        }

        return this.call({ messages: nextMessages, signal, maxTokens, isFallback, onChunk, _depth: _depth + 1 });
      }

      const text = content.find((c: any) => c.type === "text")?.text || "";
      
      const usage = {
        promptTokens: data.usage?.input_tokens || 0,
        completionTokens: data.usage?.output_tokens || 0,
        totalTokens: (data.usage?.input_tokens || 0) + (data.usage?.output_tokens || 0)
      };

      const cost = calculateCost(
        "anthropic", 
        this.config.model, 
        usage.promptTokens, 
        usage.completionTokens
      );

      return { text, usage, cost, raw: data };

    } catch (err) {
      if ((err as Error).name === "AbortError") {
        logger.warn({ provider: this.name }, "Anthropic call aborted");
        throw err;
      }
      logger.error({ err, provider: this.name }, "Anthropic call failed");
      throw err;
    }
  }
}
