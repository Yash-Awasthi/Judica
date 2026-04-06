import logger from "../../logger.js";
import { BaseProvider } from "../baseProvider.js";
import { ProviderConfig, ProviderResponse, Message } from "../types.js";
import { calculateCost } from "../../cost.js";
import { validateSafeUrl } from "../../ssrf.js";
import { getToolDefinitions, callTool } from "../../tools/index.js";

/**
 * Anthropic (Claude) provider implementation.
 * Handles Messages API with specific tool block structure.
 */
export class AnthropicProvider extends BaseProvider {
  private defaultBaseUrl = "https://api.anthropic.com/v1/messages";

  constructor(config: ProviderConfig) {
    super(config);
  }

  async call({ messages, signal, maxTokens }: {
    messages: Message[];
    signal?: AbortSignal;
    maxTokens?: number;
  }): Promise<ProviderResponse> {
    const url = this.config.baseUrl || this.defaultBaseUrl;
    await validateSafeUrl(url);

    const controller = new AbortController();
    if (signal) {
      if (signal.aborted) controller.abort();
      signal.addEventListener("abort", () => controller.abort());
    }

    try {
      const res = await fetch(url, {
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

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error?.message ?? `Anthropic API error: ${res.status}`);
      }

      const content = data.content || [];
      const toolCalls = content.filter((c: any) => c.type === "tool_use");

      // Handle Recursive Tool Calls
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

        return this.call({ messages: nextMessages, signal, maxTokens });
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
