import { Provider } from "../lib/providers.js";

import { env } from "./env.js";

/**
 * Defines specific model overrides for fallbacks.
 */
export const MODEL_FALLBACK_MAP: Record<string, Partial<Provider>> = {};

/**
 * Defines which provider types should fallback to what.
 * All fallbacks point to Gemini 2.5 Flash since it is the most reliably
 * available provider across all configured API keys.
 * 
 * Provider types: "api" | "local" | "rpa"
 * - "api" -> falls back to another API provider
 * - "local" -> falls back to API provider (cloud)
 * - "rpa" -> falls back to API provider (cloud)
 */
export const FALLBACK_MAP: Record<string, Partial<Provider>> = {
  "api": {
    type: "api",
    model: "gemini-2.5-flash",
    apiKey: env.GOOGLE_API_KEY || "",
    name: "Gemini API Fallback",
  },
  "local": {
    // Local failures fallback to cloud API
    type: "api",
    model: "gemini-2.5-flash",
    apiKey: env.GOOGLE_API_KEY || "",
    name: "Cloud API Fallback",
  },
  "rpa": {
    // RPA failures fallback to cloud API
    type: "api",
    model: "gemini-2.5-flash",
    apiKey: env.GOOGLE_API_KEY || "",
    name: "Cloud API Fallback",
  },
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
