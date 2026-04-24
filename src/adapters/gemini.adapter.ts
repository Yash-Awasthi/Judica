import type {
  IProviderAdapter,
  AdapterRequest,
  AdapterChunk,
  AdapterStreamResult,
} from "./types.js";
import { createStreamResult } from "./types.js";
import { validateSafeUrl } from "../lib/ssrf.js";
import { getBreaker } from "../lib/breaker.js";

const DEFAULT_TIMEOUT_MS = 60_000;

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
    // Validate model name to prevent URL path injection
    if (!/^[a-zA-Z0-9._-]+$/.test(model)) {
      throw new Error(`Invalid model name: "${model}"`);
    }
    const body: Record<string, unknown> = {
      contents: await this.formatContents(req),
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

    // Configurable safety settings — default to BLOCK_ONLY_HIGH
    // to avoid overly aggressive blocking on legitimate council deliberations.
    body.safetySettings = [
      { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_ONLY_HIGH" },
      { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_ONLY_HIGH" },
      { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_ONLY_HIGH" },
      { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_ONLY_HIGH" },
    ];

    const url = `${this.baseUrl}/v1beta/models/${model}:streamGenerateContent?alt=sse`;

    const fetchGemini = async () =>
      fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": this.apiKey,
        },
        body: JSON.stringify(body),
        redirect: "error",
        signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
      });

    const breaker = getBreaker({ name: this.providerId } as { name: string }, fetchGemini);
    const res: Response = await breaker.fire();

    if (!res.ok) {
      const err = await res.json().catch(() => ({})) as Record<string, unknown>;
      const errObj = err as { error?: { message?: string } };
      throw new Error(errObj?.error?.message ?? `Gemini API error: ${res.status}`);
    }

    const self = this;
    return createStreamResult(self.parseStream(res));
  }

  private async formatContents(req: AdapterRequest): Promise<Record<string, unknown>[]> {
    const contents: Record<string, unknown>[] = [];

    for (const m of req.messages) {
      if (m.role === "system") continue; // Handled via systemInstruction

      const role = m.role === "assistant" ? "model" : "user";

      if (m.role === "tool") {
        // Gemini expects functionResponse.response to wrap content as a string
        const rawContent = typeof m.content === "string" ? m.content : JSON.stringify(m.content);
        contents.push({
          role: "function",
          parts: [
            {
              functionResponse: {
                name: m.name || "tool",
                response: { content: rawContent },
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
        const parts: Record<string, unknown>[] = [];
        for (const block of m.content) {
          if (block.type === "text") {
            parts.push({ text: block.text });
          } else if (block.type === "image_base64") {
            parts.push({ inlineData: { mimeType: block.media_type, data: block.data } });
          } else if (block.type === "image_url" && block.url) {
            // Degrade image_url to text placeholder directly (no fetch to avoid SSRF)
            parts.push({ text: `[Image: ${block.url}]` });
          } else {
            parts.push({ text: String(block.text || "") });
          }
        }
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

            // Handle Gemini stream error events (e.g. safety filter, quota)
            if (parsed.error) {
              yield { type: "text", text: `[Gemini error: ${parsed.error.message || parsed.error.status || "unknown"}]` };
              continue;
            }

            const candidate = parsed.candidates?.[0];

            if (candidate?.content?.parts) {
              for (const part of candidate.content.parts) {
                if (part.text) {
                  yield { type: "text", text: part.text };
                }
                if (part.functionCall) {
                  // Use crypto.randomUUID() for deterministic-length unique IDs
                  // instead of Date.now() + Math.random() which produces collisions under load
                  yield {
                    type: "tool_call",
                    tool_call: {
                      id: `gemini-${crypto.randomUUID()}`,
                      name: part.functionCall.name,
                      arguments: part.functionCall.args || {},
                    },
                  };
                }
              }
            }

            // Accumulate usage — only emit once at end (not progressively)
            if (parsed.usageMetadata) {
              totalPromptTokens = parsed.usageMetadata.promptTokenCount || totalPromptTokens;
              totalCompletionTokens = parsed.usageMetadata.candidatesTokenCount || totalCompletionTokens;
            }
          } catch {
            // skip malformed chunks
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
        `${this.baseUrl}/v1beta/models`,
        {
          signal: AbortSignal.timeout(10000),
          headers: { "x-goog-api-key": this.apiKey },
        }
      );
      if (!res.ok) return [];
      const data = await res.json() as { models?: Array<{ name?: string }> };
      return (data.models || [])
        .filter((m) => m.name?.includes("gemini"))
        .map((m) => m.name!.replace("models/", ""))
        .sort();
    } catch {
      return [];
    }
  }

  async isAvailable(): Promise<boolean> {
    try {
      const res = await fetch(
        `${this.baseUrl}/v1beta/models`,
        {
          signal: AbortSignal.timeout(5000),
          headers: { "x-goog-api-key": this.apiKey },
        }
      );
      return res.ok;
    } catch {
      return false;
    }
  }
}
