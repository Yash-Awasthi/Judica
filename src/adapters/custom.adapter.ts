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
import type { Provider } from "../lib/providers.js";

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

  constructor(config: CustomProviderConfig) {
    this.providerId = `custom_${config.id}`;
    this.config = config;
  }

  // P7-37: Wrap decrypt in try/catch to avoid leaking internal state
  private getApiKey(): string {
    if (!this.config.auth_key_encrypted) return "";
    try {
      return decrypt(this.config.auth_key_encrypted);
    } catch {
      throw new Error(`Failed to decrypt API key for custom adapter "${this.config.name}"`);
    }
  }

  async generate(req: AdapterRequest): Promise<AdapterStreamResult> {
    const baseUrl = this.config.base_url.replace(/\/$/, "");
    // P7-39: Validate base URL against SSRF in all paths (streaming & non-streaming)
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
      case "api_key_query":
        // API key will be appended as a query parameter to the URL
        break;
      case "basic": {
        // P7-38: Validate basic auth credentials are non-empty before encoding
        const [username, password] = apiKey.includes(":") ? [apiKey.split(":")[0], apiKey.split(":").slice(1).join(":")] : [apiKey, ""];
        if (!username) {
          throw new Error(`Basic auth for "${this.config.name}" requires a non-empty username`);
        }
        headers["Authorization"] = `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
        break;
      }
      // "none" doesn't need headers
    }

    let url = `${baseUrl}/chat/completions`;

    // Append API key as query parameter for api_key_query auth type
    if (this.config.auth_type === "api_key_query") {
      const separator = url.includes("?") ? "&" : "?";
      url = `${url}${separator}api_key=${apiKey}`;
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
        redirect: "error",
        signal: AbortSignal.timeout(60000),
      });

    const breaker = getBreaker({ name: this.providerId } as Provider, fetchCustom);
    const res: Response = await breaker.fire();

    if (!res.ok) {
      const err = await res.json().catch(() => ({})) as Record<string, unknown>;
      const errObj = err as { error?: { message?: string } };
      throw new Error(
        errObj?.error?.message ?? `${this.config.name} API error: ${res.status}`
      );
    }

    if (this.config.capabilities.streaming && res.body) {
      return createStreamResult(this.parseSSE(res));
    }

    // Non-streaming: parse response and yield as single chunks
    const data = await res.json() as Record<string, unknown>;
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
    // P7-36: Track tool calls across streaming chunks
    const pendingToolCalls = new Map<number, { id: string; name: string; args: string }>();

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
          if (dataStr === "[DONE]") {
            // Emit accumulated tool calls
            for (const [, tc] of pendingToolCalls) {
              let args: string | Record<string, unknown> = tc.args;
              try { args = JSON.parse(tc.args); } catch { /* keep as string */ }
              yield { type: "tool_call", tool_call: { id: tc.id, name: tc.name, arguments: args } };
            }
            continue;
          }

          try {
            const parsed = JSON.parse(dataStr);
            const delta = parsed.choices?.[0]?.delta;
            const content = delta?.content;
            if (content) yield { type: "text", text: content };

            // P7-36: Parse tool calls from delta
            if (delta?.tool_calls) {
              for (const tc of delta.tool_calls) {
                const i = tc.index ?? pendingToolCalls.size;
                if (!pendingToolCalls.has(i)) {
                  pendingToolCalls.set(i, { id: tc.id || "", name: tc.function?.name || "", args: "" });
                }
                const p = pendingToolCalls.get(i)!;
                if (tc.id) p.id = tc.id;
                if (tc.function?.name) p.name = tc.function.name;
                if (tc.function?.arguments) p.args += tc.function.arguments;
              }
            }

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

  private async *yieldNonStream(data: Record<string, unknown>): AsyncGenerator<AdapterChunk> {
    const choices = data.choices as Array<{ message?: { content?: string } }> | undefined;
    const text = choices?.[0]?.message?.content || "";
    if (text) yield { type: "text", text };

    const usage = data.usage as { prompt_tokens?: number; completion_tokens?: number } | undefined;
    if (usage) {
      yield {
        type: "usage",
        usage: {
          prompt_tokens: usage.prompt_tokens || 0,
          completion_tokens: usage.completion_tokens || 0,
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

      // Apply auth based on auth_type
      switch (this.config.auth_type) {
        case "bearer":
          headers["Authorization"] = `Bearer ${apiKey}`;
          break;
        case "api_key_header":
          headers[this.config.auth_header_name || "X-API-Key"] = apiKey;
          break;
        case "api_key_query":
          // P7-35: Use header instead of query param
          headers["X-API-Key"] = apiKey;
          break;
        case "basic": {
          const [username, password] = apiKey.includes(":") ? [apiKey.split(":")[0], apiKey.split(":").slice(1).join(":")] : [apiKey, ""];
          if (username) {
            headers["Authorization"] = `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
          }
          break;
        }
      }

      // SSRF validation
      await validateSafeUrl(`${baseUrl}/models`);

      const url = new URL(`${baseUrl}/models`);

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
