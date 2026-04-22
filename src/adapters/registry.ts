// P2-01: src/adapters/ is the canonical provider layer.
// All other layers (lib/providers/, lib/strategies/, config/providerConfig.ts) are legacy
// and should be migrated to delegate to this adapter registry.
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

// P7-01: Lazy initialization via memoized getter — prevents side-effects at module load
let _initialized = false;

function ensureInitialized(): void {
  if (_initialized) return;
  _initialized = true;
  initBuiltinAdapters();
}

/** Get a registered adapter by provider ID */
export function getAdapter(providerId: string): IProviderAdapter {
  ensureInitialized();
  const adapter = adapters.get(providerId);
  if (!adapter) {
    throw new Error(`No adapter registered for provider "${providerId}". Available: ${listAvailableProviders().join(", ")}`);
  }
  return adapter;
}

/** Get an adapter if available, or null */
export function getAdapterOrNull(providerId: string): IProviderAdapter | null {
  ensureInitialized();
  return adapters.get(providerId) || null;
}

/** List all registered provider IDs */
export function listAvailableProviders(): string[] {
  ensureInitialized();
  return Array.from(adapters.keys());
}

/** Register a new adapter (used for custom/dynamic providers) */
export function registerAdapter(id: string, adapter: IProviderAdapter): void {
  ensureInitialized();
  adapters.set(id, adapter);
  logger.info({ providerId: id }, "Adapter registered");
}

/** Remove an adapter */
export function deregisterAdapter(id: string): void {
  ensureInitialized();
  adapters.delete(id);
  logger.info({ providerId: id }, "Adapter deregistered");
}

/** Check if a provider is registered */
export function hasAdapter(providerId: string): boolean {
  ensureInitialized();
  return adapters.has(providerId);
}

/** P7-04: Reset registry — for testing and hot-reload */
export function resetRegistry(): void {
  adapters.clear();
  _initialized = false;
}

// P7-02: Structured model → provider routing table (replaces error-prone substring heuristics)
const MODEL_PROVIDER_RULES: Array<{ test: (m: string) => boolean; provider: string }> = [
  // OpenAI
  { test: (m) => m.startsWith("gpt-") || m.startsWith("o1") || m.startsWith("o3") || m.startsWith("o4") || m.startsWith("chatgpt"), provider: "openai" },
  // Anthropic
  { test: (m) => m.startsWith("claude"), provider: "anthropic" },
  // Gemini
  { test: (m) => m.startsWith("gemini"), provider: "gemini" },
  // Groq-hosted models — check BEFORE Ollama since Groq uses explicit model IDs
  { test: (m) => m.includes("groq/") || m.startsWith("llama-") || m.startsWith("llama3") || m.includes("-versatile") || m.includes("-specdec"), provider: "groq" },
  // P7-03: Mixtral — prefer Mistral adapter (native), fallback to Groq
  { test: (m) => m.startsWith("mixtral-") || m.includes("mixtral"), provider: "mistral" },
  { test: (m) => m.startsWith("mixtral-") || m.includes("mixtral"), provider: "groq" },
  { test: (m) => m.startsWith("gemma-") || m.startsWith("gemma2-"), provider: "groq" },
  // Mistral direct (not via OpenRouter)
  { test: (m) => m.startsWith("mistral-") || m.startsWith("codestral") || m.startsWith("pixtral"), provider: "mistral" },
  // Ollama — only match generic model family names (user's local models)
  { test: (m) => m.startsWith("ollama/") || m.includes(":") /* ollama tag format e.g. llama3:8b */, provider: "ollama" },
  // OpenRouter — model IDs always contain a slash (org/model)
  { test: (m) => m.includes("/"), provider: "openrouter" },
];

/**
 * Resolve a provider ID from a model name.
 * P7-02: Uses structured routing table instead of ambiguous substring matching.
 */
export function resolveProviderFromModel(model: string): string | null {
  const m = model.toLowerCase();

  for (const rule of MODEL_PROVIDER_RULES) {
    if (rule.test(m) && hasAdapter(rule.provider)) {
      return rule.provider;
    }
  }

  return null;
}

function initBuiltinAdapters(): void {
  // P7-04: Clear before re-populating to prevent duplicate registrations on reload
  adapters.clear();

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

  // P4-19: Additional providers — Azure OpenAI, Bedrock-proxy, Vertex-proxy, Fireworks, Together, DeepInfra.
  // All are OpenAI-compatible endpoints; users just need to set the env var.
  // Azure OpenAI uses a custom base URL with deployment names as model IDs.
  // P19-04: Validate AZURE_OPENAI_ENDPOINT to prevent SSRF via env-var injection
  const azureEndpoint = process.env.AZURE_OPENAI_ENDPOINT || "https://YOUR_RESOURCE.openai.azure.com/openai/deployments";
  const isAzureEndpointSafe = /^https:\/\/[a-z0-9-]+\.openai\.azure\.com\b/i.test(azureEndpoint);
  if (process.env.AZURE_OPENAI_ENDPOINT && !isAzureEndpointSafe) {
    logger.warn({ endpoint: azureEndpoint.slice(0, 60) }, "AZURE_OPENAI_ENDPOINT rejected — must be https://*.openai.azure.com");
  }
  const extraProviders: Array<{ id: string; envKey: string; baseUrl: string }> = [
    { id: "azure-openai", envKey: "AZURE_OPENAI_API_KEY", baseUrl: isAzureEndpointSafe ? azureEndpoint : "https://YOUR_RESOURCE.openai.azure.com/openai/deployments" },
    { id: "fireworks", envKey: "FIREWORKS_API_KEY", baseUrl: "https://api.fireworks.ai/inference/v1" },
    { id: "together", envKey: "TOGETHER_API_KEY", baseUrl: "https://api.together.xyz/v1" },
    { id: "deepinfra", envKey: "DEEPINFRA_API_KEY", baseUrl: "https://api.deepinfra.com/v1/openai" },
    // P4-41: Perplexity adapter — tests/adapters/perplexity.test.ts exercises this path
    { id: "perplexity", envKey: "PERPLEXITY_API_KEY", baseUrl: "https://api.perplexity.ai" },
  ];

  for (const { id, envKey, baseUrl } of extraProviders) {
    const key = process.env[envKey];
    if (key) {
      adapters.set(id, new OpenAIAdapter(key, baseUrl, id));
      logger.debug(`${id} adapter loaded (OpenAI-compat)`);
    }
  }

  const count = adapters.size;
  logger.info({ count, providers: listAvailableProviders() }, "Adapter registry initialized");
}

// P7-01: Removed eager initBuiltinAdapters() call — now lazy via ensureInitialized()
// P7-04: clearRegistry() added above for clean re-init on reload
