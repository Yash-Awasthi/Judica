import logger from "../../logger.js";
import { BaseProvider } from "../baseProvider.js";
import { ProviderConfig, ProviderResponse, Message } from "../types.js";
import { calculateCost } from "../../cost.js";
import { validateSafeUrl } from "../../ssrf.js";
import { getToolDefinitions, callTool } from "../../tools/index.js";

export class OpenAIProvider extends BaseProvider {
  private defaultBaseUrl = "https://api.openai.com/v1";

  constructor(config: ProviderConfig) {
    super(config);
  }

  async call({ messages, signal, maxTokens, isFallback, onChunk }: {
    messages: Message[];
    signal?: AbortSignal;
    maxTokens?: number;
    isFallback?: boolean;
    onChunk?: (chunk: string) => void;
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
          stream: !!onChunk,
          messages: [
            ...(this.config.systemPrompt ? [{ role: "system", content: this.config.systemPrompt }] : []),
            ...messages,
          ],
          ...(oaiTools?.length ? { tools: oaiTools, tool_choice: "auto" } : {}),
        }),
      });

      if (!res.ok) {
        let errorData: any = {};
        try { errorData = await res.json(); } catch { /* ignore */ }
        throw new Error(errorData?.error?.message ?? `OpenAI API error: ${res.status}`);
      }

      if (onChunk && res.body) {
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let text = "";
        let buffer = "";

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
              if (dataStr === "[DONE]") continue;

              try {
                const parsed = JSON.parse(dataStr);
                const content = parsed.choices?.[0]?.delta?.content;
                if (content) {
                  text += content;
                  onChunk(content);
                }
              } catch (e) {
                // ignore unparseable chunk
              }
            }
          }
        }

        const usage = {
          promptTokens: 0,
          completionTokens: 0,
          totalTokens: 0
        };

        const cost = calculateCost(
          this.config.type === "api" ? "openai" : this.config.type,
          this.config.model,
          0,
          0
        );

        return { text: text.trim(), usage, cost, raw: { stream: true } };
      }

      const data = await res.json();
      const msg = data.choices?.[0]?.message;
      
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

        return this.call({ messages: nextMessages, signal, maxTokens, isFallback, onChunk });
      }

      const raw = msg?.content || "";
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
