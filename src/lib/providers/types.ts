export interface Message {
  role: "user" | "assistant" | "system" | "tool";
  content: string | ContentBlock[];
  name?: string;
  tool_call_id?: string;
}

export interface ContentBlock {
  [key: string]: unknown;
  type?: string;
  text?: string;
}

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
  tools?: string[];
  userId?: number; // Added for isolation
}
