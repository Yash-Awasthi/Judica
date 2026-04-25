// Groq adapter now extends the shared OpenAICompatibleAdapter base class.

import { OpenAICompatibleAdapter } from "./openaiCompatible.adapter.js";

export class GroqAdapter extends OpenAICompatibleAdapter {
  readonly providerId = "groq";

  constructor(apiKey: string) {
    super(apiKey, "https://api.groq.com/openai/v1");
  }

  protected override extractUsage(parsed: Record<string, unknown>): { prompt_tokens: number; completion_tokens: number } | null {
    // Groq may send usage in x_groq.usage or standard usage field
    const xGroq = parsed.x_groq as { usage?: { prompt_tokens?: number; completion_tokens?: number } } | undefined;
    const usage = xGroq?.usage || (parsed.usage as { prompt_tokens?: number; completion_tokens?: number } | undefined);
    if (usage) {
      return {
        prompt_tokens: Math.max(0, Number(usage.prompt_tokens) || 0),
        completion_tokens: Math.max(0, Number(usage.completion_tokens) || 0),
      };
    }
    return null;
  }

  // Filter model listing to only chat-capable models (exclude whisper, embedding, guard)
  protected override filterModels(models: Array<{ id: string }>): string[] {
    return models
      .map((m) => m.id)
      .filter((id) => !id.includes("whisper") && !id.includes("guard") && !id.includes("embed"))
      .sort();
  }
}
