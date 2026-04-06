import logger from "../../logger.js";
import { BaseProvider } from "../baseProvider.js";
import { ProviderConfig, ProviderResponse, Message } from "../types.js";
import { calculateCost } from "../../cost.js";
import { validateSafeUrl } from "../../ssrf.js";
import { getToolDefinitions, callTool } from "../../tools/index.js";

export class GoogleProvider extends BaseProvider {
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
      const endpoint = onChunk ? "streamGenerateContent?alt=sse&" : "generateContent?";
      const res = await fetch(
        `${apiHost}/v1beta/models/${this.config.model || "gemini-2.0-flash"}:${endpoint}key=${this.config.apiKey}`,
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

      if (!res.ok) {
        let errorData: any = {};
        try { errorData = await res.json(); } catch { /* ignore */ }
        throw new Error(errorData?.error?.message ?? `Google API error: ${res.status}`);
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
              if (!dataStr) continue;

              try {
                const parsed = JSON.parse(dataStr);
                const candidate = parsed.candidates?.[0];
                const content = candidate?.content?.parts?.[0]?.text;
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
          "google",
          this.config.model,
          0,
          0
        );

        return { text: text.trim(), usage, cost, raw: { stream: true } };
      }

      const data = await res.json();
      const candidate = data.candidates?.[0];
      const part = candidate?.content?.parts?.[0];

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

        return this.call({ messages: nextMessages, signal, maxTokens, isFallback, onChunk });
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
