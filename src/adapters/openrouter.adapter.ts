// P1-09: OpenRouter adapter now extends the shared OpenAICompatibleAdapter base class.
// P1-08: Added OpenRouter-specific transforms/route/provider.order support.
import type { AdapterRequest } from "./types.js";
import { OpenAICompatibleAdapter } from "./openaiCompatible.adapter.js";

export class OpenRouterAdapter extends OpenAICompatibleAdapter {
  readonly providerId = "openrouter";

  constructor(apiKey: string) {
    super(apiKey, "https://openrouter.ai/api/v1");
  }

  protected override getDisplayName(): string {
    return "OpenRouter";
  }

  // P7-31: Read referer from env to support white-label deployments
  protected override getExtraHeaders(): Record<string, string> {
    return {
      "HTTP-Referer": process.env.OPENROUTER_REFERER || "https://aibyai.app",
      "X-Title": process.env.OPENROUTER_TITLE || "AIBYAI Council",
    };
  }

  protected override formatMessages(req: AdapterRequest): Record<string, unknown>[] {
    const msgs: Record<string, unknown>[] = [];
    if (req.system_prompt) msgs.push({ role: "system", content: req.system_prompt });

    for (const m of req.messages) {
      if (m.tool_calls) {
        msgs.push({
          role: m.role,
          content: typeof m.content === "string" ? m.content : null,
          tool_calls: m.tool_calls.map((tc) => ({
            id: tc.id,
            type: "function",
            function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
          })),
        });
      } else if (m.role === "tool") {
        msgs.push({
          role: "tool",
          tool_call_id: m.tool_call_id,
          content: typeof m.content === "string" ? m.content : JSON.stringify(m.content),
        });
      } else if (Array.isArray(m.content)) {
        msgs.push({
          role: m.role,
          content: JSON.stringify(m.content),
        });
      } else {
        msgs.push({
          role: m.role,
          content: typeof m.content === "string" ? m.content : JSON.stringify(m.content),
        });
      }
    }
    return msgs;
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
