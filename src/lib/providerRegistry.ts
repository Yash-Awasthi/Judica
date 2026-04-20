// P2-03: DEPRECATED — This registry duplicates src/adapters/registry.ts.
// New code should use the adapter registry instead.
import { loadProviderConfig, ProviderConfig } from "../config/providerConfig.js";
import logger from "./logger.js";
import { fileURLToPath } from "url";

// P7-10: Use import.meta.url for ESM-safe path resolution (works under bundlers)
const CONFIG_URL = new URL("../config/providers.json", import.meta.url);

export type ProviderType = "api" | "local" | "rpa";
export type ApiType = "openai-compat" | "anthropic" | "google";

export interface ProviderDefinition {
  name: string;
  type: ProviderType;
  baseUrl: string;
  apiType?: ApiType;
  models: string[];
  defaultModel?: string;
  priority: number;
  timeoutMs?: number;
  maxConcurrency?: number;
  enabled: boolean;
  autoDetect?: boolean;
  requiresSetup?: boolean;
}

export interface ProviderRegistry {
  providers: ProviderDefinition[];
  fallbacks: Record<ProviderType, string>;
  limits: {
    maxRpaProviders: number;
    maxLocalProviders: number;
    maxApiProviders: number;
  };
}

interface ResolvedProvider {
  type: "openai-compat" | "anthropic" | "google";
  resolvedBaseUrl: string | undefined;
  maxTokens: number;
}

let cachedConfig: ProviderConfig[] | null = null;
let cachedRegistry: ProviderRegistry | null = null;

const DEFAULT_REGISTRY: ProviderRegistry = {
  providers: [
    {
      name: "openai",
      type: "api",
      baseUrl: "https://api.openai.com/v1",
      apiType: "openai-compat",
      models: ["gpt-4", "gpt-4o", "gpt-4o-mini", "gpt-3.5-turbo"],
      defaultModel: "gpt-4o",
      priority: 100,
      enabled: true
    },
    {
      name: "claude",
      type: "api",
      baseUrl: "https://api.anthropic.com",
      apiType: "anthropic",
      models: ["claude-3-opus", "claude-3-sonnet", "claude-3-haiku"],
      defaultModel: "claude-3-sonnet",
      priority: 95,
      enabled: true
    },
    {
      name: "ollama",
      type: "local",
      baseUrl: "http://localhost:11434",
      models: [],
      autoDetect: true,
      priority: 70,
      enabled: true
    }
  ],
  fallbacks: {
    api: "openai",
    local: "ollama",
    rpa: "chatgpt-rpa"
  },
  limits: {
    maxRpaProviders: 2,
    maxLocalProviders: 2,
    maxApiProviders: 5
  }
};

/**
 * P7-11: Derive provider list from adapter registry instead of hardcoded defaults.
 * Falls back to DEFAULT_REGISTRY if adapters module is unavailable.
 */
export async function getDerivedRegistry(): Promise<ProviderRegistry> {
  try {
    const { listAvailableProviders } = await import("../adapters/registry.js");
    const adapterProviders = listAvailableProviders();

    // Merge: start with static registry, ensure all adapter providers are present
    const base = await loadProviderRegistry();
    const existingNames = new Set(base.providers.map(p => p.name));

    for (const id of adapterProviders) {
      if (!existingNames.has(id)) {
        base.providers.push({
          name: id,
          type: "api",
          baseUrl: "",
          models: [],
          priority: 50,
          enabled: true,
        });
      }
    }
    return base;
  } catch {
    return loadProviderRegistry();
  }
}

/**
 * P7-12: Invalidate cached registry — call after config file changes or hot-reload.
 */
export function invalidateRegistryCache(): void {
  cachedConfig = null;
  cachedRegistry = null;
}
  if (!cachedConfig) {
    const config = await loadProviderConfig();
    cachedConfig = config.providers
      .filter(provider => provider.enabled !== false)
      .sort((a, b) => (b.priority || 0) - (a.priority || 0));
  }
  return cachedConfig;
}

export async function resolveProvider(provider: {
  name: string;
  type: "openai-compat" | "anthropic" | "google";
  apiKey: string;
  model: string;
  baseUrl?: string;
  systemPrompt?: string;
  maxTokens?: number;
  tools?: string[];
}): Promise<ResolvedProvider> {
  let resolvedBaseUrl = provider.baseUrl?.trim() || undefined;
  let type: "openai-compat" | "anthropic" | "google" = provider.type || "openai-compat";
  let maxTokens = provider.maxTokens ?? 1024;

  const model = provider.model?.toLowerCase() || "";
  const configs = await getProviderConfig();
  
  const matchingConfig = configs.find(config => model.includes(config.pattern));

  if (matchingConfig) {
    if (!resolvedBaseUrl && matchingConfig.baseUrl) {
      resolvedBaseUrl = matchingConfig.baseUrl;
    }
    if (!provider.type || provider.type === "openai-compat") {
      type = matchingConfig.type;
    }
    if (!provider.maxTokens) {
      maxTokens = matchingConfig.defaultMaxTokens;
    }
  }

  return { type, resolvedBaseUrl, maxTokens };
}

export async function loadProviderRegistry(): Promise<ProviderRegistry> {
  if (cachedRegistry) {
    return cachedRegistry;
  }

  try {
    const configPath = fileURLToPath(CONFIG_URL);
    const fs = await import("fs/promises");
    const data = await fs.readFile(configPath, "utf-8");
    const parsed = JSON.parse(data) as ProviderRegistry;
    
    if (!validateRegistry(parsed)) {
      logger.warn("Invalid provider registry structure, using defaults");
      cachedRegistry = DEFAULT_REGISTRY;
      return cachedRegistry;
    }
    
    cachedRegistry = parsed;
    logger.info({ providerCount: parsed.providers.length }, "Loaded provider registry");
    return cachedRegistry;
  } catch (err) {
    logger.warn({ err }, "Failed to load provider registry, using defaults");
    cachedRegistry = DEFAULT_REGISTRY;
    return cachedRegistry;
  }
}

function validateRegistry(registry: unknown): registry is ProviderRegistry {
  if (!registry || typeof registry !== "object") return false;
  
  const r = registry as Record<string, unknown>;
  
  if (!Array.isArray(r.providers)) return false;
  if (r.providers.length === 0) return false;
  
  for (const p of r.providers) {
    if (!validateProvider(p)) {
      logger.warn({ provider: p }, "Invalid provider definition");
      return false;
    }
  }
  
  if (!r.fallbacks || typeof r.fallbacks !== "object") return false;
  
  return true;
}

function validateProvider(p: unknown): p is ProviderDefinition {
  if (!p || typeof p !== "object") return false;
  
  const provider = p as Record<string, unknown>;
  
  if (typeof provider.name !== "string" || provider.name.length === 0) return false;
  if (!["api", "local", "rpa"].includes(provider.type as string)) return false;
  if (typeof provider.baseUrl !== "string" || provider.baseUrl.length === 0) return false;
  if (!Array.isArray(provider.models)) return false;
  if (typeof provider.priority !== "number") return false;
  if (typeof provider.enabled !== "boolean") return false;
  
  if (provider.timeoutMs !== undefined && (typeof provider.timeoutMs !== "number" || provider.timeoutMs < 0)) return false;
  if (provider.maxConcurrency !== undefined && (typeof provider.maxConcurrency !== "number" || provider.maxConcurrency < 1)) return false;
  if (provider.autoDetect !== undefined && typeof provider.autoDetect !== "boolean") return false;
  if (provider.requiresSetup !== undefined && typeof provider.requiresSetup !== "boolean") return false;
  
  return true;
}

export async function getProviders(): Promise<ProviderDefinition[]> {
  const registry = await loadProviderRegistry();
  return registry.providers.filter(p => p.enabled);
}

export async function getProviderByName(name: string): Promise<ProviderDefinition | null> {
  const registry = await loadProviderRegistry();
  const provider = registry.providers.find(p => p.name === name && p.enabled);
  return provider || null;
}

export async function getProvidersByType(type: ProviderType): Promise<ProviderDefinition[]> {
  const registry = await loadProviderRegistry();
  return registry.providers.filter(p => p.type === type && p.enabled);
}

export async function getFallbackProvider(type: ProviderType): Promise<string | null> {
  const registry = await loadProviderRegistry();
  return registry.fallbacks[type] || null;
}

export async function isProviderLimitReached(type: ProviderType): Promise<boolean> {
  const registry = await loadProviderRegistry();
  const activeCount = registry.providers.filter(p => p.type === type && p.enabled).length;
  
  switch (type) {
    case "rpa":
      return activeCount >= registry.limits.maxRpaProviders;
    case "local":
      return activeCount >= registry.limits.maxLocalProviders;
    case "api":
      return activeCount >= registry.limits.maxApiProviders;
    default:
      return false;
  }
}

export function getProviderDefaults(provider: ProviderDefinition): Required<Pick<ProviderDefinition, 'timeoutMs' | 'maxConcurrency'>> {
  return {
    timeoutMs: provider.timeoutMs ?? 60000, // 60 seconds default
    maxConcurrency: provider.maxConcurrency ?? 3 // 3 concurrent requests default
  };
}

