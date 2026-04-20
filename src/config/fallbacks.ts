// P2-07: Emergency-last-resort fallback ONLY.
// This is NOT the primary fallback chain — that's in src/router/providerChain.ts.
// This file only activates when the legacy askProvider() path fails AND chain is exhausted.
import { Provider } from "../lib/providers.js";
import { env } from "./env.js";
import logger from "../lib/logger.js";

// P2-08: Warn at startup if fallback is disabled
if (!env.GOOGLE_API_KEY) {
  logger.warn("GOOGLE_API_KEY not set — emergency fallback provider disabled. If all primary providers fail, requests will return 503.");
}

export const FALLBACK_MAP: Record<string, Partial<Provider>> = {
  "api": {
    type: "api",
    model: "gemini-2.5-flash-preview-05-20",
    apiKey: env.GOOGLE_API_KEY || "",
    name: "Emergency Gemini Fallback",
  },
};

// P2-09: Single source of truth — only "api" type has a fallback.
// Local and RPA should NOT fall back to a cloud API silently.

export function getFallbackProvider(original: Provider): Provider | null {
  // Only provide fallback for API-type providers
  if (original.type !== "api") return null;

  const fallbackData = FALLBACK_MAP["api"];
  if (!fallbackData || !fallbackData.apiKey) {
    return null;
  }

  return {
    ...original,
    ...fallbackData,
    name: `${original.name} (Emergency Fallback: ${fallbackData.model})`,
  } as Provider;
}
