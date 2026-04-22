import { BaseProvider } from "./baseProvider.js";
import type { ProviderConfig } from "./types.js";
import { OpenAIProvider } from "./concrete/openai.js";
import { AnthropicProvider } from "./concrete/anthropic.js";
import { GoogleProvider } from "./concrete/google.js";
import { OllamaProvider } from "./concrete/ollama.js";
import { RPAProvider } from "./concrete/rpa.js";
import { decrypt } from "../crypto.js";
import logger from "../logger.js";
import { ProviderConfigError } from "../providers.js";

export function createProvider(config: ProviderConfig): BaseProvider {
  const decryptedConfig = { ...config };

  // P0-17: Try to decrypt the API key if it looks encrypted
  if (decryptedConfig.apiKey) {
    // Only attempt decryption if the key appears to be encrypted
    // Raw API keys follow known formats: sk-..., gsk_..., key-..., etc.
    const looksRaw = /^(sk-|gsk_|key-|xai-|AIza|ghp_|glpat-)/.test(decryptedConfig.apiKey);
    if (!looksRaw) {
      try {
        decryptedConfig.apiKey = decrypt(decryptedConfig.apiKey);
      } catch (err) {
        throw new ProviderConfigError(
          `Failed to decrypt API key for provider "${config.name}": ${(err as Error).message}. ` +
          `If the key is not encrypted, ensure it starts with a known prefix (sk-, gsk_, etc.)`
        );
      }
    }
  }

  // P7-16: Use typed ProviderConfigError instead of raw strings
  if (!config.type) {
    throw new ProviderConfigError("missing required 'type' field");
  }

  if (decryptedConfig.provider) {
    switch (decryptedConfig.provider) {
      case "openai":    return new OpenAIProvider(decryptedConfig);
      case "anthropic": return new AnthropicProvider(decryptedConfig);
      case "google":    return new GoogleProvider(decryptedConfig);
      case "ollama":    return new OllamaProvider(decryptedConfig);
      case "chatgpt":
      case "claude":
      case "deepseek":
      case "gemini":    return new RPAProvider(decryptedConfig);
    }
  }

  const type = (decryptedConfig.type || "").toLowerCase();

  // P7-16: Typed error + P7-17: removed dead "openai-compat" branch
  if (!["api", "local", "rpa"].includes(type)) {
    throw new ProviderConfigError(`invalid type '${type}'. Must be 'api', 'local', or 'rpa'`);
  }

  const lowerName = (decryptedConfig.name || "").toLowerCase();
  const lowerModel = (decryptedConfig.model || "").toLowerCase();

  if (type === "rpa") return new RPAProvider(decryptedConfig);

  switch (type) {
    case "api":
      if (lowerName.includes("anthropic") || lowerModel.includes("claude")) {
        return new AnthropicProvider(decryptedConfig);
      }
      if (lowerName.includes("google") || lowerModel.includes("gemini")) {
        return new GoogleProvider(decryptedConfig);
      }
      return new OpenAIProvider(decryptedConfig);

    case "local":
      return new OllamaProvider(decryptedConfig);

    default:
      // P7-16: Typed error class
      throw new ProviderConfigError(`Unsupported provider type: ${decryptedConfig.type}`);
  }
}
