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
export { normalizeToolArguments, normalizeSystemPrompt } from "./types.js";

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

export { getEmbeddingProvider, setEmbeddingProvider } from "./embeddingModel.adapter.js";
export type { EmbeddingProvider } from "./embeddingModel.adapter.js";
export { getVectorAdapter, setVectorAdapter } from "./vectorDb.adapter.js";
export type { VectorDbAdapter, VectorSearchResult } from "./vectorDb.adapter.js";
