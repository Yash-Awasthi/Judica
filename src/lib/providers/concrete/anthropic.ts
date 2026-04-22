import logger from "../../logger.js";
import { BaseProvider } from "../baseProvider.js";
import type { ProviderConfig, ProviderResponse, Message } from "../types.js";
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
    const onAbort = () => controller.abort();
    if (signal) {
      if (signal.aborted) controller.abort();
      else signal.addEventListener("abort", onAbort, { once: true });
    }

    try {
      const res = await this.protectedFetch(url, {
        method: "POST",
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          "x-api-key": this.config.apiKey,
          // P1-07: Updated to 2023-10-01 for parallel tools and cache_control support
          "anthropic-version": "2023-10-01",
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
        let errorData: Record<string, unknown> = {};
        try { errorData = await res.json() as Record<string, unknown>; } catch { /* ignore */ }
        const errObj = errorData as { error?: { message?: string } };
        throw new Error(errObj?.error?.message ?? `Anthropic API error: ${res.status}`);
      }

      if (onChunk && res.body) {
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let text = "";
        let buffer = "";
        let streamInputTokens = 0;
        let streamOutputTokens = 0;
        // P1-04: Track tool calls during streaming so they aren't dropped
        // P40-02: Cap pending tools to prevent unbounded memory growth
        const MAX_PENDING_TOOLS = 100;
        const pendingTools = new Map<number, { id: string; name: string; args: string }>();
        let currentBlockIndex = 0;

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
                if (parsed.type === "content_block_start") {
                  currentBlockIndex = parsed.index ?? currentBlockIndex;
                  if (parsed.content_block?.type === "tool_use") {
                    if (pendingTools.size < MAX_PENDING_TOOLS) {
                      pendingTools.set(currentBlockIndex, {
                        id: parsed.content_block.id,
                        name: parsed.content_block.name,
                        args: "",
                      });
                    }
                  }
                }
                if (parsed.type === "content_block_delta") {
                  currentBlockIndex = parsed.index ?? currentBlockIndex;
                  if (parsed.delta?.text) {
                    text += parsed.delta.text;
                    onChunk(parsed.delta.text);
                  }
                  if (parsed.delta?.type === "input_json_delta" && parsed.delta.partial_json) {
                    const tool = pendingTools.get(currentBlockIndex);
                    // P40-03: Cap tool args to prevent unbounded string concatenation
                    if (tool && tool.args.length < 1_000_000) tool.args += parsed.delta.partial_json;
                  }
                }
                if (parsed.type === "content_block_stop") {
                  // Tool call completed — will be handled after stream ends
                  currentBlockIndex = parsed.index ?? currentBlockIndex;
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

        // P1-04: If tool calls were found in the stream, process them recursively
        if (pendingTools.size > 0) {
          const assistantContent: Record<string, unknown>[] = [];
          if (text) assistantContent.push({ type: "text", text });
          for (const [, tc] of pendingTools) {
            let args: Record<string, unknown> = {};
            try { args = JSON.parse(tc.args); } catch { /* empty */ }
            assistantContent.push({ type: "tool_use", id: tc.id, name: tc.name, input: args });
          }

          const nextMessages: Message[] = [...messages, { role: "assistant", content: assistantContent } as Message];
          for (const [, tc] of pendingTools) {
            let args: Record<string, unknown> = {};
            try { args = JSON.parse(tc.args); } catch { /* empty */ }
            const result = await callTool({ id: tc.id, name: tc.name, arguments: args });
            const safeResult = `[UNTRUSTED TOOL OUTPUT]\n${result.result || result}\n[/UNTRUSTED TOOL OUTPUT]`;
            nextMessages.push({
              role: "user",
              content: [{ type: "tool_result", tool_use_id: tc.id, content: safeResult }]
            } as Message);
          }

          return this.call({ messages: nextMessages, signal, maxTokens, isFallback, onChunk, _depth: _depth + 1 });
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
      const toolCalls = content.filter((c: Record<string, unknown>) => c.type === "tool_use");

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
          } as Message);
        }

        return this.call({ messages: nextMessages, signal, maxTokens, isFallback, onChunk, _depth: _depth + 1 });
      }

      const text = content.find((c: Record<string, unknown>) => c.type === "text")?.text as string || "";
      
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

      signal?.removeEventListener("abort", onAbort);
      return { text, usage, cost, raw: data };

    } catch (err) {
      signal?.removeEventListener("abort", onAbort);
      if ((err as Error).name === "AbortError") {
        logger.warn({ provider: this.name }, "Anthropic call aborted");
        throw err;
      }
      logger.error({ err, provider: this.name }, "Anthropic call failed");
      throw err;
    }
  }
}
