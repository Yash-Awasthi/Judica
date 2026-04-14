import type {
  IProviderAdapter,
  AdapterRequest,
  AdapterChunk,
  AdapterStreamResult,
} from "./types.js";
import { createStreamResult } from "./types.js";
import { decrypt } from "../lib/crypto.js";
import { validateSafeUrl } from "../lib/ssrf.js";
import { getBreaker } from "../lib/breaker.js";
import logger from "../lib/logger.js";

export interface CustomProviderConfig {
  id: string;
  name: string;
  base_url: string;
  auth_type: "bearer" | "api_key_query" | "api_key_header" | "basic" | "none";
  auth_key_encrypted: string; // AES-256-GCM encrypted
  auth_header_name?: string; // Custom header name for api_key_header type
  capabilities: {
    streaming: boolean;
    tools: boolean;
    vision: boolean;
  };
  models: string[];
}

export class CustomAdapter implements IProviderAdapter {
  readonly providerId: string;
  private config: CustomProviderConfig;
  private decryptedKey: string | null = null;

  constructor(config: CustomProviderConfig) {
    this.providerId = `custom_${config.id}`;
    this.config = config;
  }

  private getApiKey(): string {
    if (!this.decryptedKey) {
      this.decryptedKey = this.config.auth_key_encrypted
        ? decrypt(this.config.auth_key_encrypted)
        : "";
    }
    return this.decryptedKey;
  }

  async generate(req: AdapterRequest): Promise<AdapterStreamResult> {
    const baseUrl = this.config.base_url.replace(/\/$/, "");
    // Validate base URL against SSRF (blocks private IPs, localhost, cloud metadata)
    await validateSafeUrl(baseUrl);
    const apiKey = this.getApiKey();

    // Build headers based on auth type
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    switch (this.config.auth_type) {
      case "bearer":
        headers["Authorization"] = `Bearer ${apiKey}`;
        break;
      case "api_key_header":
        headers[this.config.auth_header_name || "X-API-Key"] = apiKey;
        break;
      case "basic":
        headers["Authorization"] = `Basic ${Buffer.from(apiKey).toString("base64")}`;
        break;
      // api_key_query and none don't need headers
    }

    // Build URL
    let url = `${baseUrl}/chat/completions`;
    if (this.config.auth_type === "api_key_query") {
      const urlObj = new URL(url);
      urlObj.searchParams.set("api_key", apiKey);
      url = urlObj.toString();
    }

    // Build OpenAI-compatible request body
    const body: Record<string, unknown> = {
      model: req.model || this.config.models[0],
      stream: this.config.capabilities.streaming,
      messages: this.formatMessages(req),
    };

    if (req.temperature !== undefined) body.temperature = req.temperature;
    if (req.max_tokens) body.max_tokens = req.max_tokens;
    if (req.top_p !== undefined) body.top_p = req.top_p;

    if (req.tools?.length && this.config.capabilities.tools) {
      body.tools = req.tools.map((t) => ({
        type: "function",
        function: { name: t.name, description: t.description, parameters: t.parameters },
      }));
      body.tool_choice = "auto";
    }

    const fetchCustom = async () =>
      fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(60000),
      });

    const breaker = getBreaker({ name: this.providerId } as any, fetchCustom);
    const res: Response = await breaker.fire();

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(
        (err as any)?.error?.message ?? `${this.config.name} API error: ${res.status}`
      );
    }

    if (this.config.capabilities.streaming && res.body) {
      return createStreamResult(this.parseSSE(res));
    }

    // Non-streaming: parse response and yield as single chunks
    const data: any = await res.json();
    const self = this;
    return createStreamResult(self.yieldNonStream(data));
  }

  private formatMessages(req: AdapterRequest): Record<string, unknown>[] {
    const msgs: Record<string, unknown>[] = [];
    if (req.system_prompt) msgs.push({ role: "system", content: req.system_prompt });

    for (const m of req.messages) {
      if (m.role === "tool") {
        msgs.push({
          role: "tool",
          tool_call_id: m.tool_call_id,
          content: typeof m.content === "string" ? m.content : JSON.stringify(m.content),
        });
      } else {
        msgs.push({
          role: m.role,
          content: typeof m.content === "string" ? m.content : JSON.stringify(m.content),
        });
      }
    }
    return msgs;
  }

  private async *parseSSE(res: Response): AsyncGenerator<AdapterChunk> {
    if (!res.body) return;

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        let idx: number;
        while ((idx = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, idx).trim();
          buffer = buffer.slice(idx + 1);

          if (!line.startsWith("data: ")) continue;
          const dataStr = line.slice(6).trim();
          if (dataStr === "[DONE]") continue;

          try {
            const parsed = JSON.parse(dataStr);
            const content = parsed.choices?.[0]?.delta?.content;
            if (content) yield { type: "text", text: content };

            if (parsed.usage) {
              yield {
                type: "usage",
                usage: {
                  prompt_tokens: parsed.usage.prompt_tokens || 0,
                  completion_tokens: parsed.usage.completion_tokens || 0,
                },
              };
            }
          } catch { /* skip */ }
        }
      }
    } finally {
      reader.releaseLock();
    }

    yield { type: "done" };
  }

  private async *yieldNonStream(data: any): AsyncGenerator<AdapterChunk> {
    const text = data.choices?.[0]?.message?.content || "";
    if (text) yield { type: "text", text };

    if (data.usage) {
      yield {
        type: "usage",
        usage: {
          prompt_tokens: data.usage.prompt_tokens || 0,
          completion_tokens: data.usage.completion_tokens || 0,
        },
      };
    }

    yield { type: "done" };
  }

  async listModels(): Promise<string[]> {
    return this.config.models;
  }

  async isAvailable(): Promise<boolean> {
    try {
      const baseUrl = this.config.base_url.replace(/\/$/, "");
      const apiKey = this.getApiKey();
      const headers: Record<string, string> = {};

      // Apply auth based on auth_type (not just bearer)
      switch (this.config.auth_type) {
        case "bearer":
          headers["Authorization"] = `Bearer ${apiKey}`;
          break;
        case "api_key_header":
          headers[this.config.auth_header_name || "X-API-Key"] = apiKey;
          break;
        case "basic":
          headers["Authorization"] = `Basic ${Buffer.from(apiKey).toString("base64")}`;
          break;
        // api_key_query handled below
      }

      // SSRF validation
      await validateSafeUrl(`${baseUrl}/models`);

      const url = new URL(`${baseUrl}/models`);
      if (this.config.auth_type === "api_key_query") {
        url.searchParams.set("api_key", apiKey);
      }

      const res = await fetch(url.toString(), {
        headers,
        signal: AbortSignal.timeout(5000),
      });
      return res.ok;
    } catch {
      return false;
    }
  }
}
