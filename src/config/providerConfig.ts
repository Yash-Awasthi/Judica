import logger from "../lib/logger.js";
import { env } from "./env.js";

export interface ProviderConfig {
  pattern: string;
  baseUrl?: string;
  type: "openai-compat" | "anthropic" | "google";
  defaultMaxTokens: number;
  priority?: number;
  enabled?: boolean;
}

export interface ProviderRegistryConfig {
  providers: ProviderConfig[];
  fallbacks?: Record<string, string>;
}

export const DEFAULT_PROVIDER_CONFIG: ProviderRegistryConfig = {
  providers: [
    {
      pattern: "llama-3.3-70b-versatile",
      baseUrl: "https://api.groq.com/openai/v1",
      type: "openai-compat",
      defaultMaxTokens: 8192,
      priority: 110
    },
    {
      pattern: "llama-3.1-8b-instant",
      baseUrl: "https://api.groq.com/openai/v1",
      type: "openai-compat",
      defaultMaxTokens: 4096,
      priority: 100
    },

    {
      pattern: "nvidia/",
      baseUrl: "https://openrouter.ai/api/v1",
      type: "openai-compat",
      defaultMaxTokens: 4096,
      priority: 90
    },
    {
      pattern: "google/",
      baseUrl: "https://openrouter.ai/api/v1",
      type: "openai-compat",
      defaultMaxTokens: 4096,
      priority: 90
    },
    {
      pattern: "meta/",
      baseUrl: "https://openrouter.ai/api/v1",
      type: "openai-compat",
      defaultMaxTokens: 4096,
      priority: 90
    },

    {
      pattern: "mistral-large-latest",
      baseUrl: "https://api.mistral.ai/v1",
      type: "openai-compat",
      defaultMaxTokens: 8192,
      priority: 85
    },
    {
      pattern: "mistral",
      baseUrl: "https://api.mistral.ai/v1",
      type: "openai-compat",
      defaultMaxTokens: 4096,
      priority: 80
    },

    {
      pattern: "kimi",
      baseUrl: "https://integrate.api.nvidia.com/v1",
      type: "openai-compat",
      defaultMaxTokens: 2048,
      priority: 70
    },
    {
      pattern: "glm",
      baseUrl: "https://integrate.api.nvidia.com/v1",
      type: "openai-compat",
      defaultMaxTokens: 2048,
      priority: 70
    },
    {
      pattern: "minimax",
      baseUrl: "https://integrate.api.nvidia.com/v1",
      type: "openai-compat",
      defaultMaxTokens: 2048,
      priority: 70
    },
    {
      pattern: "nemotron",
      baseUrl: "https://integrate.api.nvidia.com/v1",
      type: "openai-compat",
      defaultMaxTokens: 4096,
      priority: 70
    },

    {
      pattern: "gemini",
      type: "google",
      defaultMaxTokens: 4096,
      priority: 60
    },
    {
      pattern: "claude",
      type: "anthropic",
      defaultMaxTokens: 4096,
      priority: 60
    }
  ],
  fallbacks: {
    "openai-compat": "https://api.openai.com/v1",
    "anthropic": "https://api.anthropic.com",
    "google": "https://generativelanguage.googleapis.com"
  }
};

export async function loadProviderConfig(): Promise<ProviderRegistryConfig> {
  const configPath = env.PROVIDER_REGISTRY_CONFIG;
  
  if (!configPath) {
    return DEFAULT_PROVIDER_CONFIG;
  }

  try {
    const fs = await import('fs/promises');
    const configData = await fs.readFile(configPath, 'utf-8');
    const config = JSON.parse(configData) as ProviderRegistryConfig;
    
    if (!config.providers || !Array.isArray(config.providers)) {
      throw new Error('Invalid provider config: providers array is required');
    }
    
    return config;
  } catch (error) {
    logger.warn({ error, configPath }, "Failed to load provider config, using defaults");
    return DEFAULT_PROVIDER_CONFIG;
  }
}
