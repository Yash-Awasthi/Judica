import type { IProviderAdapter } from "./types.js";
import { OpenAIAdapter } from "./openai.adapter.js";
import { AnthropicAdapter } from "./anthropic.adapter.js";
import { GeminiAdapter } from "./gemini.adapter.js";
import { GroqAdapter } from "./groq.adapter.js";
import { OpenRouterAdapter } from "./openrouter.adapter.js";
import { OllamaAdapter } from "./ollama.adapter.js";
import { env } from "../config/env.js";
import logger from "../lib/logger.js";

const adapters = new Map<string, IProviderAdapter>();

/** Get a registered adapter by provider ID */
export function getAdapter(providerId: string): IProviderAdapter {
  const adapter = adapters.get(providerId);
  if (!adapter) {
    throw new Error(`No adapter registered for provider "${providerId}". Available: ${listAvailableProviders().join(", ")}`);
  }
  return adapter;
}

/** Get an adapter if available, or null */
export function getAdapterOrNull(providerId: string): IProviderAdapter | null {
  return adapters.get(providerId) || null;
}

/** List all registered provider IDs */
export function listAvailableProviders(): string[] {
  return Array.from(adapters.keys());
}

/** Register a new adapter (used for custom/dynamic providers) */
export function registerAdapter(id: string, adapter: IProviderAdapter): void {
  adapters.set(id, adapter);
  logger.info({ providerId: id }, "Adapter registered");
}

/** Remove an adapter */
export function deregisterAdapter(id: string): void {
  adapters.delete(id);
  logger.info({ providerId: id }, "Adapter deregistered");
}

/** Check if a provider is registered */
export function hasAdapter(providerId: string): boolean {
  return adapters.has(providerId);
}

/**
 * Resolve a provider ID from a model name.
 * Heuristic mapping of model names/prefixes to provider IDs.
 */
export function resolveProviderFromModel(model: string): string | null {
  const m = model.toLowerCase();

  // OpenAI models
  if (m.startsWith("gpt-") || m.startsWith("o1") || m.startsWith("o3") || m.startsWith("o4") || m.startsWith("chatgpt")) {
    return hasAdapter("openai") ? "openai" : null;
  }

  // Anthropic models
  if (m.startsWith("claude")) {
    return hasAdapter("anthropic") ? "anthropic" : null;
  }

  // Gemini models
  if (m.startsWith("gemini")) {
    return hasAdapter("gemini") ? "gemini" : null;
  }

  // Ollama models (check first since these could also match Groq patterns)
  if (hasAdapter("ollama") && (m.includes("llama") || m.includes("mistral") || m.includes("phi") || m.includes("qwen"))) {
    return "ollama";
  }

  // Groq models (llama, mixtral on groq)
  if (hasAdapter("groq") && (m.includes("llama") || m.includes("mixtral") || m.includes("gemma"))) {
    return "groq";
  }

  // OpenRouter models (usually contain a /)
  if (m.includes("/") && hasAdapter("openrouter")) {
    return "openrouter";
  }

  return null;
}

function initBuiltinAdapters(): void {
  if (env.OPENAI_API_KEY) {
    adapters.set("openai", new OpenAIAdapter(env.OPENAI_API_KEY));
    logger.debug("OpenAI adapter loaded");
  }

  if (env.ANTHROPIC_API_KEY) {
    adapters.set("anthropic", new AnthropicAdapter(env.ANTHROPIC_API_KEY));
    logger.debug("Anthropic adapter loaded");
  }

  if (env.GOOGLE_API_KEY) {
    adapters.set("gemini", new GeminiAdapter(env.GOOGLE_API_KEY));
    logger.debug("Gemini adapter loaded");
  }

  if (env.GROQ_API_KEY) {
    adapters.set("groq", new GroqAdapter(env.GROQ_API_KEY));
    logger.debug("Groq adapter loaded");
  }

  if (env.OPENROUTER_API_KEY) {
    adapters.set("openrouter", new OpenRouterAdapter(env.OPENROUTER_API_KEY));
    logger.debug("OpenRouter adapter loaded");
  }

  // Ollama — always try to register (it's local, free, no key needed)
  adapters.set("ollama", new OllamaAdapter(env.OLLAMA_BASE_URL));
  logger.debug("Ollama adapter loaded (local)");

  // OpenAI-compatible providers via OpenAI adapter with custom base URL
  if (env.MISTRAL_API_KEY) {
    adapters.set("mistral", new OpenAIAdapter(env.MISTRAL_API_KEY, "https://api.mistral.ai/v1", "mistral"));
    logger.debug("Mistral adapter loaded (OpenAI-compat)");
  }

  if (env.CEREBRAS_API_KEY) {
    adapters.set("cerebras", new OpenAIAdapter(env.CEREBRAS_API_KEY, "https://api.cerebras.ai/v1", "cerebras"));
    logger.debug("Cerebras adapter loaded (OpenAI-compat)");
  }

  if (env.NVIDIA_API_KEY) {
    adapters.set("nvidia", new OpenAIAdapter(env.NVIDIA_API_KEY, "https://integrate.api.nvidia.com/v1", "nvidia"));
    logger.debug("NVIDIA adapter loaded (OpenAI-compat)");
  }

  const count = adapters.size;
  logger.info({ count, providers: listAvailableProviders() }, "Adapter registry initialized");
}

// Initialize on module load
initBuiltinAdapters();
