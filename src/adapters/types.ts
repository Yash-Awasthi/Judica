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
  // P7-05: Accept both JSON string and object — providers differ in what they emit
  arguments: string | Record<string, unknown>;
}

/**
 * P7-05: Normalize tool call arguments to a consistent object form.
 * Call this at the adapter boundary before passing to downstream code.
 */
export function normalizeToolArguments(args: string | Record<string, unknown>): Record<string, unknown> {
  if (typeof args === "string") {
    try {
      return JSON.parse(args);
    } catch {
      return { raw: args };
    }
  }
  return args;
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
  // P7-09: system_prompt is the CANONICAL way to pass system instructions.
  // If messages also contains role:"system", adapters should use normalizeSystemPrompt() to merge.
  system_prompt?: string;
}

/**
 * P7-09: Normalize system prompt — merges system_prompt field with any system-role messages.
 * Adapters should call this once before dispatching to the provider.
 * Returns { systemPrompt, messages } where messages has no system-role entries.
 */
export function normalizeSystemPrompt(req: AdapterRequest): { systemPrompt: string | undefined; messages: AdapterMessage[] } {
  const systemMessages = req.messages.filter(m => m.role === "system");
  const nonSystemMessages = req.messages.filter(m => m.role !== "system");

  const parts: string[] = [];
  if (req.system_prompt) parts.push(req.system_prompt);
  for (const msg of systemMessages) {
    const text = typeof msg.content === "string" ? msg.content : msg.content.map(b => b.text || "").join("");
    if (text) parts.push(text);
  }

  return {
    systemPrompt: parts.length > 0 ? parts.join("\n\n") : undefined,
    messages: nonSystemMessages,
  };
}

export interface AdapterChunk {
  type: "text" | "tool_call" | "usage" | "done" | "error";
  text?: string;
  tool_call?: AdapterToolCall;
  usage?: AdapterUsage;
  error?: string;
  // P7-06: Finish reason — only present on "done" chunks
  finish_reason?: "stop" | "length" | "tool_calls" | "content_filter";
}

// P2-06: This is the CANONICAL Usage type (snake_case).
// Legacy ProviderUsage in lib/providers/types.ts uses camelCase — it should migrate here.
export interface AdapterUsage {
  prompt_tokens: number;
  completion_tokens: number;
  // P7-07: Extended metadata for cost accounting and SLO tracking
  cost?: number;
  latency_ms?: number;
  provider_id?: string;
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
  // P7-06: Propagate finish_reason from the done chunk
  finish_reason?: "stop" | "length" | "tool_calls" | "content_filter";
}

/**
 * Helper to create an AdapterStreamResult from an async generator.
 * P3-11: Note — `.stream` and `.collect()` both consume the same generator.
 * Callers must use ONE or the OTHER, never both. Calling collect() first
 * then iterating stream will yield nothing (generator is exhausted).
 * collect() is idempotent: subsequent calls return the cached result.
 */
export function createStreamResult(
  gen: AsyncGenerator<AdapterChunk>
): AdapterStreamResult {
  let collected: AdapterCollectedResponse | null = null;
  let streamConsumed = false;

  const wrappedGen = async function* (): AsyncGenerator<AdapterChunk> {
    if (collected) {
      // Stream was already collected — replay from cache
      if (collected.text) yield { type: "text", text: collected.text };
      for (const tc of collected.tool_calls) yield { type: "tool_call", tool_call: tc };
      yield { type: "usage", usage: collected.usage };
      yield { type: "done" };
      return;
    }
    streamConsumed = true;
    yield* gen;
  };

  return {
    stream: wrappedGen(),
    async collect(): Promise<AdapterCollectedResponse> {
      if (collected) return collected;

      let text = "";
      const tool_calls: AdapterToolCall[] = [];
      let usage: AdapterUsage = { prompt_tokens: 0, completion_tokens: 0 };
      let complete = false;
      let finish_reason: AdapterCollectedResponse["finish_reason"];

      // If stream was already partially consumed, we can't collect reliably
      const source = streamConsumed ? gen : gen;
      for await (const chunk of source) {
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
          case "done":
            complete = true;
            finish_reason = chunk.finish_reason;
            break;
          case "error":
            throw new Error(chunk.error || "Unknown adapter error");
        }
      }

      // P7-08: Reject incomplete streams (no "done" chunk received)
      // Exception: if no chunks were received at all (empty/null body), return empty result
      const hasAnyContent = text !== "" || tool_calls.length > 0 || usage.prompt_tokens > 0 || usage.completion_tokens > 0;
      if (!complete && hasAnyContent) {
        throw new Error("Incomplete stream: connection closed without a final 'done' chunk");
      }

      collected = { text, tool_calls, usage, finish_reason };
      return collected;
    },
  };
}
