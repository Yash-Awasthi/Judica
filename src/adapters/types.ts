// ─── Unified Adapter Types ───────────────────────────────────────────────────
// One interface. All providers go through it. Zero provider-specific code in routes.

export interface AdapterMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | AdapterContentBlock[];
  tool_call_id?: string;
  tool_calls?: AdapterToolCall[];
  name?: string;
}

export interface AdapterContentBlock {
  type: "text" | "image_url" | "image_base64";
  text?: string;
  url?: string;
  data?: string;
  media_type?: string;
}

export interface AdapterToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface AdapterTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>; // JSON Schema
}

export interface AdapterRequest {
  model: string;
  messages: AdapterMessage[];
  tools?: AdapterTool[];
  stream?: boolean;
  temperature?: number;
  max_tokens?: number;
  top_p?: number;
  system_prompt?: string;
}

export interface AdapterChunk {
  type: "text" | "tool_call" | "usage" | "done" | "error";
  text?: string;
  tool_call?: AdapterToolCall;
  usage?: AdapterUsage;
  error?: string;
}

export interface AdapterUsage {
  prompt_tokens: number;
  completion_tokens: number;
}

export interface IProviderAdapter {
  readonly providerId: string;
  generate(req: AdapterRequest): Promise<AdapterStreamResult>;
  listModels(): Promise<string[]>;
  isAvailable(): Promise<boolean>;
}

export interface AdapterStreamResult {
  stream: AsyncGenerator<AdapterChunk>;
  /** Convenience: collect all text from stream into a single response */
  collect(): Promise<AdapterCollectedResponse>;
}

export interface AdapterCollectedResponse {
  text: string;
  tool_calls: AdapterToolCall[];
  usage: AdapterUsage;
}

// Helper to create an AdapterStreamResult from an async generator
export function createStreamResult(
  gen: AsyncGenerator<AdapterChunk>
): AdapterStreamResult {
  let collected: AdapterCollectedResponse | null = null;

  return {
    stream: gen,
    async collect(): Promise<AdapterCollectedResponse> {
      if (collected) return collected;

      let text = "";
      const tool_calls: AdapterToolCall[] = [];
      let usage: AdapterUsage = { prompt_tokens: 0, completion_tokens: 0 };

      for await (const chunk of gen) {
        switch (chunk.type) {
          case "text":
            text += chunk.text || "";
            break;
          case "tool_call":
            if (chunk.tool_call) tool_calls.push(chunk.tool_call);
            break;
          case "usage":
            if (chunk.usage) usage = chunk.usage;
            break;
          case "error":
            throw new Error(chunk.error || "Unknown adapter error");
        }
      }

      collected = { text, tool_calls, usage };
      return collected;
    },
  };
}
