import type {
  IProviderAdapter,
  AdapterRequest,
  AdapterChunk,
  AdapterStreamResult,
} from "./types.js";
import { createStreamResult } from "./types.js";
import { validateSafeUrl } from "../lib/ssrf.js";
import logger from "../lib/logger.js";

export class GeminiAdapter implements IProviderAdapter {
  readonly providerId = "gemini";
  private apiKey: string;
  private baseUrl = "https://generativelanguage.googleapis.com";

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async generate(req: AdapterRequest): Promise<AdapterStreamResult> {
    await validateSafeUrl(this.baseUrl);

    const model = req.model || "gemini-2.0-flash";
    const body: Record<string, unknown> = {
      contents: this.formatContents(req),
      generationConfig: {} as Record<string, unknown>,
    };

    const genConfig = body.generationConfig as Record<string, unknown>;
    if (req.max_tokens) genConfig.maxOutputTokens = req.max_tokens;
    if (req.temperature !== undefined) genConfig.temperature = req.temperature;
    if (req.top_p !== undefined) genConfig.topP = req.top_p;

    if (req.system_prompt) {
      body.systemInstruction = { parts: [{ text: req.system_prompt }] };
    }

    if (req.tools?.length) {
      body.tools = [
        {
          function_declarations: req.tools.map((t) => ({
            name: t.name,
            description: t.description,
            parameters: t.parameters,
          })),
        },
      ];
    }

    const url = `${this.baseUrl}/v1beta/models/${model}:streamGenerateContent?alt=sse&key=${this.apiKey}`;

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error((err as any)?.error?.message ?? `Gemini API error: ${res.status}`);
    }

    const self = this;
    return createStreamResult(self.parseStream(res));
  }

  private formatContents(req: AdapterRequest): Record<string, unknown>[] {
    const contents: Record<string, unknown>[] = [];

    for (const m of req.messages) {
      if (m.role === "system") continue; // Handled via systemInstruction

      const role = m.role === "assistant" ? "model" : "user";

      if (m.role === "tool") {
        contents.push({
          role: "function",
          parts: [
            {
              functionResponse: {
                name: m.name || "tool",
                response: {
                  content: typeof m.content === "string" ? m.content : JSON.stringify(m.content),
                },
              },
            },
          ],
        });
        continue;
      }

      if (m.tool_calls) {
        const parts = m.tool_calls.map((tc) => ({
          functionCall: { name: tc.name, args: tc.arguments },
        }));
        contents.push({ role: "model", parts });
        continue;
      }

      if (Array.isArray(m.content)) {
        const parts = m.content.map((block) => {
          if (block.type === "text") return { text: block.text };
          if (block.type === "image_base64") {
            return { inlineData: { mimeType: block.media_type, data: block.data } };
          }
          if (block.type === "image_url") return { text: `[Image: ${block.url}]` };
          return { text: String(block.text || "") };
        });
        contents.push({ role, parts });
      } else {
        contents.push({
          role,
          parts: [{ text: typeof m.content === "string" ? m.content : JSON.stringify(m.content) }],
        });
      }
    }

    return contents;
  }

  private async *parseStream(res: Response): AsyncGenerator<AdapterChunk> {
    if (!res.body) return;

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let totalPromptTokens = 0;
    let totalCompletionTokens = 0;

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
            const candidate = parsed.candidates?.[0];

            if (candidate?.content?.parts) {
              for (const part of candidate.content.parts) {
                if (part.text) {
                  yield { type: "text", text: part.text };
                }
                if (part.functionCall) {
                  yield {
                    type: "tool_call",
                    tool_call: {
                      id: `gemini-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                      name: part.functionCall.name,
                      arguments: part.functionCall.args || {},
                    },
                  };
                }
              }
            }

            if (parsed.usageMetadata) {
              totalPromptTokens = parsed.usageMetadata.promptTokenCount || totalPromptTokens;
              totalCompletionTokens = parsed.usageMetadata.candidatesTokenCount || totalCompletionTokens;
            }
          } catch {
            // skip
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    yield {
      type: "usage",
      usage: { prompt_tokens: totalPromptTokens, completion_tokens: totalCompletionTokens },
    };
    yield { type: "done" };
  }

  async listModels(): Promise<string[]> {
    try {
      const res = await fetch(
        `${this.baseUrl}/v1beta/models?key=${this.apiKey}`,
        { signal: AbortSignal.timeout(10000) }
      );
      if (!res.ok) return [];
      const data: any = await res.json();
      return (data.models || [])
        .filter((m: any) => m.name?.includes("gemini"))
        .map((m: any) => m.name.replace("models/", ""))
        .sort();
    } catch {
      return [];
    }
  }

  async isAvailable(): Promise<boolean> {
    try {
      const res = await fetch(
        `${this.baseUrl}/v1beta/models?key=${this.apiKey}`,
        { signal: AbortSignal.timeout(5000) }
      );
      return res.ok;
    } catch {
      return false;
    }
  }
}
