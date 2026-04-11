// ─── Adapters barrel export ──────────────────────────────────────────────────
export type {
  IProviderAdapter,
  AdapterRequest,
  AdapterMessage,
  AdapterContentBlock,
  AdapterToolCall,
  AdapterTool,
  AdapterChunk,
  AdapterUsage,
  AdapterStreamResult,
  AdapterCollectedResponse,
} from "./types.js";
export { createStreamResult } from "./types.js";

export { OpenAIAdapter } from "./openai.adapter.js";
export { AnthropicAdapter } from "./anthropic.adapter.js";
export { GeminiAdapter } from "./gemini.adapter.js";
export { GroqAdapter } from "./groq.adapter.js";
export { OpenRouterAdapter } from "./openrouter.adapter.js";
export { OllamaAdapter } from "./ollama.adapter.js";

export {
  getAdapter,
  getAdapterOrNull,
  listAvailableProviders,
  registerAdapter,
  deregisterAdapter,
  hasAdapter,
  resolveProviderFromModel,
} from "./registry.js";
