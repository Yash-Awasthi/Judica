import { Provider } from "../lib/providers.js";

import { env } from "./env.js";

/**
 * Defines specific model overrides for fallbacks.
 */
export const MODEL_FALLBACK_MAP: Record<string, Partial<Provider>> = {
  "gpt-4o": {
    type: "anthropic",
    model: "claude-3-5-sonnet-20241022",
    apiKey: env.ANTHROPIC_API_KEY || "",
    name: "Anthropic Fallback (Sonnet)",
  },
};

/**
 * Defines which model types or specific models should fallback to what.
 * This is a default map that can be expanded.
 */
export const FALLBACK_MAP: Record<string, Partial<Provider>> = {
  "anthropic": {
    type: "openai-compat",
    model: "gpt-4o-mini",
    apiKey: env.OPENAI_API_KEY || "",
    name: "OpenAI Fallback",
  },
  "google": {
    type: "openai-compat",
    model: "gpt-4o-mini",
    apiKey: env.OPENAI_API_KEY || "",
    name: "OpenAI Fallback",
  },
  "openai-compat": {
    type: "anthropic",
    model: "claude-3-5-haiku-20241022",
    apiKey: env.ANTHROPIC_API_KEY || "",
    name: "Anthropic Fallback",
  }
};

/**
 * Returns a fallback provider configuration if one is defined.
 */
export function getFallbackProvider(original: Provider): Provider | null {
  // Try specific model first
  let fallbackData = MODEL_FALLBACK_MAP[original.model];
  
  // Try by type if no model-specific override
  if (!fallbackData) {
    fallbackData = FALLBACK_MAP[original.type];
  }

  if (!fallbackData || !fallbackData.apiKey) {
    return null;
  }

  return {
    ...original, // keep name, systemPrompt, maxTokens if possible
    ...fallbackData as Provider,
    name: `${original.name} (Fallback: ${fallbackData.model})`,
  };
}
