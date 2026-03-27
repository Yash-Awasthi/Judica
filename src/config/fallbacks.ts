import { Provider } from "../lib/providers.js";

import { env } from "./env.js";

/**
 * Defines specific model overrides for fallbacks.
 */
export const MODEL_FALLBACK_MAP: Record<string, Partial<Provider>> = {};

/**
 * Defines which model types or specific models should fallback to what.
 * All fallbacks point to Gemini 2.5 Flash since it is the most reliably
 * available provider across all configured API keys.
 */
export const FALLBACK_MAP: Record<string, Partial<Provider>> = {
  "anthropic": {
    type: "google",
    model: "gemini-2.5-flash",
    apiKey: env.GOOGLE_API_KEY || "",
    name: "Gemini Fallback",
  },
  "openai-compat": {
    type: "google",
    model: "gemini-2.5-flash",
    apiKey: env.GOOGLE_API_KEY || "",
    name: "Gemini Fallback",
  },
  "google": {
    // If Google itself fails, try Groq as alternative
    type: "openai-compat",
    model: "gpt-4o",
    apiKey: env.OPENAI_API_KEY || "",
    baseUrl: "https://api.openai.com/v1",
    name: "OpenAI Fallback",
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
