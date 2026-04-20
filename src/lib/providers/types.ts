export interface Message {
  role: "user" | "assistant" | "system" | "tool";
  content: string | ContentBlock[];
  name?: string;
  tool_call_id?: string;
  // P7-21: Add tool_calls for assistant messages that invoke tools
  tool_calls?: Array<{
    id: string;
    name: string;
    arguments: string | Record<string, unknown>;
  }>;
}

// P7-19: Discriminated union for content blocks (replaces permissive index signature)
export type ContentBlock =
  | { type: "text"; text: string }
  | { type: "image_url"; url: string }
  | { type: "image_base64"; data: string; media_type: string }
  | { type: "audio"; data: string; media_type: string }
  | { type: "tool_result"; tool_use_id: string; content: string };

export interface ProviderUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface ProviderResponse {
  text: string;
  usage: ProviderUsage;
  cost?: number;
  raw?: unknown;
}

export interface ProviderConfig {
  name: string;
  type: "api" | "local" | "rpa";
  provider?: "openai" | "anthropic" | "google" | "ollama" | "chatgpt" | "claude" | "deepseek" | "gemini";
  apiKey: string;
  model: string;
  baseUrl?: string;
  systemPrompt?: string;
  maxTokens?: number;
  timeoutMs?: number;
  tools?: string[];
  // P7-20: Accept both number and string for userId (supports UUID-based auth)
  userId?: string | number;
}
