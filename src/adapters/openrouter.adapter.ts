// P1-09: OpenRouter adapter now extends the shared OpenAICompatibleAdapter base class.
// P1-08: Added OpenRouter-specific transforms/route/provider.order support.
import type { AdapterRequest } from "./types.js";
import { OpenAICompatibleAdapter } from "./openaiCompatible.adapter.js";

export class OpenRouterAdapter extends OpenAICompatibleAdapter {
  readonly providerId = "openrouter";

  constructor(apiKey: string) {
    super(apiKey, "https://openrouter.ai/api/v1");
  }

  // P7-31: Read referer from env to support white-label deployments
  protected override getExtraHeaders(): Record<string, string> {
    return {
      "HTTP-Referer": process.env.OPENROUTER_REFERER || "https://aibyai.app",
      "X-Title": process.env.OPENROUTER_TITLE || "AIBYAI Council",
    };
  }

  protected override getExtraBody(req: AdapterRequest): Record<string, unknown> {
    // P1-08: Use OpenRouter's built-in routing features
    const extra: Record<string, unknown> = {
      transforms: ["middle-out"],
      route: "fallback",
    };
    if (req.model) {
      extra.provider = { order: ["Together", "DeepInfra", "Fireworks"] };
    }
    return extra;
  }
}
