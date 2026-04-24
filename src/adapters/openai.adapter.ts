// OpenAI adapter now extends the shared OpenAICompatibleAdapter base class.
import { OpenAICompatibleAdapter } from "./openaiCompatible.adapter.js";

export class OpenAIAdapter extends OpenAICompatibleAdapter {
  readonly providerId: string;

  constructor(apiKey: string, baseUrl = "https://api.openai.com/v1", providerId = "openai") {
    // Validate baseUrl to prevent SSRF via custom provider configuration
    let parsed: URL;
    try {
      parsed = new URL(baseUrl);
    } catch {
      throw new Error(`Invalid OpenAI base URL: ${baseUrl}`);
    }
    if (!["http:", "https:"].includes(parsed.protocol)) {
      throw new Error(`Unsupported protocol in OpenAI base URL: ${parsed.protocol}`);
    }
    super(apiKey, baseUrl);
    this.providerId = providerId;
  }

  protected override getDisplayName(): string {
    return "OpenAI";
  }

  protected override getStreamOptions(): Record<string, unknown> {
    return { stream_options: { include_usage: true } };
  }

  protected override filterModels(models: Array<{ id: string }>): string[] {
    // Use a regex allowlist pattern instead of hardcoded prefixes.
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
