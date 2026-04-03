import logger from "../../logger.js";
import { BaseProvider } from "../baseProvider.js";
import { ProviderConfig, ProviderResponse, Message } from "../types.js";
import { calculateCost } from "../../cost.js";
import { validateSafeUrl } from "../../ssrf.js";
import { getToolDefinitions, callTool } from "../../tools/index.js";

/**
 * OpenAI-compatible provider implementation.
 * Handles standard ChatCompletions API with tool support.
 */
export class OpenAIProvider extends BaseProvider {
  private defaultBaseUrl = "https://api.openai.com/v1";

  constructor(config: ProviderConfig) {
    super(config);
  }

  /**
   * Main execution logic for OpenAI-compatible providers.
   * Supports recursive tool calling.
   */
  async call({ messages, signal, maxTokens, isFallback }: {
    messages: Message[];
    signal?: AbortSignal;
    maxTokens?: number;
    isFallback?: boolean;
  }): Promise<ProviderResponse> {
    const url = (this.config.baseUrl || this.defaultBaseUrl).replace(/\/$/, "");
    await validateSafeUrl(url);

    const oaiTools = getToolDefinitions(this.config.tools || []).map(t => ({
      type: "function",
      function: { name: t.name, description: t.description, parameters: t.parameters }
    }));

    const controller = new AbortController();
    if (signal) {
      if (signal.aborted) controller.abort();
      signal.addEventListener("abort", () => controller.abort());
    }

    try {
      const res = await fetch(`${url}/chat/completions`, {
        method: "POST",
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify({
          model: this.config.model,
          max_tokens: maxTokens || this.config.maxTokens,
          messages: [
            ...(this.config.systemPrompt ? [{ role: "system", content: this.config.systemPrompt }] : []),
            ...messages,
          ],
          ...(oaiTools?.length ? { tools: oaiTools, tool_choice: "auto" } : {}),
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error?.message ?? `OpenAI API error: ${res.status}`);
      }

      const msg = data.choices?.[0]?.message;
      
      // Handle Tool Calls
      if (msg?.tool_calls?.length) {
        logger.info({ 
          provider: this.name, 
          toolCount: msg.tool_calls.length 
        }, "Processing provider tool calls");

        const nextMessages = [...messages, msg];
        for (const tc of msg.tool_calls) {
          const result = await callTool({ 
            id: tc.id, 
            name: tc.function.name, 
            arguments: JSON.parse(tc.function.arguments) 
          });
          
          const safeResult = `[UNTRUSTED TOOL OUTPUT]\n${result.result || result}\n[/UNTRUSTED TOOL OUTPUT]`;
          nextMessages.push({ 
            role: "tool", 
            tool_call_id: tc.id, 
            name: tc.function.name, 
            content: safeResult 
          } as any);
        }

        // Recursive call with tool results
        return this.call({ messages: nextMessages, signal, maxTokens, isFallback });
      }

      const raw = msg?.content || "";
      // Strip <think> tags for cleaner synthesis
      const text = raw.replace(/<think>[\s\S]*?<\/think>/g, "").trim();

      const usage = {
        promptTokens: data.usage?.prompt_tokens || 0,
        completionTokens: data.usage?.completion_tokens || 0,
        totalTokens: data.usage?.total_tokens || 0
      };

      const cost = calculateCost(
        this.config.type === "api" ? "openai" : this.config.type, 
        this.config.model, 
        usage.promptTokens, 
        usage.completionTokens
      );

      return { text, usage, cost, raw: data };

    } catch (err) {
      if ((err as Error).name === "AbortError") {
        logger.warn({ provider: this.name }, "OpenAI call aborted");
        throw err;
      }
      logger.error({ err, provider: this.name }, "OpenAI call failed");
      throw err;
    }
  }
}
