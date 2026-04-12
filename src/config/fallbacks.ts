import { Provider } from "../lib/providers.js";

import { env } from "./env.js";

export const FALLBACK_MAP: Record<string, Partial<Provider>> = {
  "api": {
    type: "api",
    model: "gemini-2.5-flash",
    apiKey: env.GOOGLE_API_KEY || "",
    name: "Gemini API Fallback",
  },
  "local": {
    type: "api",
    model: "gemini-2.5-flash",
    apiKey: env.GOOGLE_API_KEY || "",
    name: "Cloud API Fallback",
  },
  "rpa": {
    type: "api",
    model: "gemini-2.5-flash",
    apiKey: env.GOOGLE_API_KEY || "",
    name: "Cloud API Fallback",
  },
};

export function getFallbackProvider(original: Provider): Provider | null {
  let fallbackData = FALLBACK_MAP[original.type];

  if (!fallbackData || !fallbackData.apiKey) {
    return null;
  }

  return {
    ...original,
    ...fallbackData,
    name: `${original.name} (Fallback: ${fallbackData.model})`,
  } as Provider;
}
