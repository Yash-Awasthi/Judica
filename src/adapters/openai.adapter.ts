// P1-09: OpenAI adapter now extends the shared OpenAICompatibleAdapter base class.
import { OpenAICompatibleAdapter } from "./openaiCompatible.adapter.js";

export class OpenAIAdapter extends OpenAICompatibleAdapter {
  readonly providerId: string;

  constructor(apiKey: string, baseUrl = "https://api.openai.com/v1", providerId = "openai") {
    super(apiKey, baseUrl);
    this.providerId = providerId;
  }

  protected override getStreamOptions(): Record<string, unknown> {
    return { stream_options: { include_usage: true } };
  }

  protected override filterModels(models: Array<{ id: string }>): string[] {
    // P3-05: Use a regex allowlist pattern instead of hardcoded prefixes.
    // Matches gpt-*, o1-*, o3-*, o4-*, and future model families.
    // Excludes embedding, tts, dall-e, whisper, and other non-chat models.
    const CHAT_MODEL_RE = /^(gpt-|o[1-9]|chatgpt-)/;
    const EXCLUDE_RE = /^(gpt-.*-(?:realtime|audio)|.*-(?:embedding|tts|whisper|dall-e))/;
    return models
      .filter((m) => CHAT_MODEL_RE.test(m.id) && !EXCLUDE_RE.test(m.id))
      .map((m) => m.id)
      .sort();
  }
}
