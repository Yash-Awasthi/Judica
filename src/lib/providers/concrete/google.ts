import logger from "../../logger.js";
import { BaseProvider } from "../baseProvider.js";
import { ProviderConfig, ProviderResponse, Message } from "../types.js";
import { calculateCost } from "../../cost.js";
import { validateSafeUrl } from "../../ssrf.js";
import { getToolDefinitions, callTool } from "../../tools/index.js";

/**
 * Google (Gemini) provider implementation.
 * Handles Gemini API (v1beta) with specific content/parts structure.
 */
export class GoogleProvider extends BaseProvider {
  constructor(config: ProviderConfig) {
    super(config);
  }

  async call({ messages, signal, maxTokens, isFallback }: {
    messages: Message[];
    signal?: AbortSignal;
    maxTokens?: number;
  }): Promise<ProviderResponse> {
    // Note: Google's API key is typically a query param, but we validate the host
    const apiHost = "https://generativelanguage.googleapis.com";
    await validateSafeUrl(apiHost);

    const controller = new AbortController();
    if (signal) {
      if (signal.aborted) controller.abort();
      signal.addEventListener("abort", () => controller.abort());
    }

    const googleContents = messages.map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: typeof m.content === "string" ? m.content : JSON.stringify(m.content) }],
    }));

    try {
      const res = await fetch(
        `${apiHost}/v1beta/models/${this.config.model || "gemini-2.0-flash"}:generateContent?key=${this.config.apiKey}`,
        {
          method: "POST",
          signal: controller.signal,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...(this.config.systemPrompt
              ? { systemInstruction: { parts: [{ text: this.config.systemPrompt }] } }
              : {}),
            contents: googleContents,
            generationConfig: { maxOutputTokens: maxTokens || this.config.maxTokens },
            tools: getToolDefinitions(this.config.tools || []).length ? [{
              function_declarations: getToolDefinitions(this.config.tools || []).map(t => ({
                name: t.name,
                description: t.description,
                parameters: t.parameters
              }))
            }] : undefined
          }),
        }
      );

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error?.message ?? `Google API error: ${res.status}`);
      }

      const candidate = data.candidates?.[0];
      const part = candidate?.content?.parts?.[0];

      // Handle Tool Calls
      if (part?.functionCall) {
        const { name, args } = part.functionCall;
        logger.info({ provider: this.name, toolName: name }, "Processing Google tool call");

        const result = await callTool({ 
          id: `google-${Date.now()}`, 
          name, 
          arguments: args 
        });
        
        const safeResult = `[UNTRUSTED TOOL OUTPUT]\n${result.result || result}\n[/UNTRUSTED TOOL OUTPUT]`;
        
        const nextMessages: Message[] = [
          ...messages, 
          { role: "assistant", content: JSON.stringify(part) },
          { role: "tool", name, content: safeResult } as any
        ];

        return this.call({ messages: nextMessages, signal, maxTokens, isFallback });
      }

      const text = part?.text || "";
      
      const usage = {
        promptTokens: data.usageMetadata?.promptTokenCount || 0,
        completionTokens: data.usageMetadata?.candidatesTokenCount || 0,
        totalTokens: data.usageMetadata?.totalTokenCount || 0
      };

      const cost = calculateCost(
        "google", 
        this.config.model, 
        usage.promptTokens, 
        usage.completionTokens
      );

      return { text, usage, cost, raw: data };

    } catch (err) {
      if ((err as Error).name === "AbortError") {
        logger.warn({ provider: this.name }, "Google call aborted");
        throw err;
      }
      logger.error({ err, provider: this.name }, "Google call failed");
      throw err;
    }
  }
}
