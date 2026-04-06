import { BaseProvider } from "./baseProvider.js";
import { ProviderConfig } from "./types.js";
import { OpenAIProvider } from "./concrete/openai.js";
import { AnthropicProvider } from "./concrete/anthropic.js";
import { GoogleProvider } from "./concrete/google.js";
import { OllamaProvider } from "./concrete/ollama.js";
import { RPAProvider } from "./concrete/rpa.js";
import { decrypt } from "../crypto.js";
import logger from "../logger.js";

export function createProvider(config: ProviderConfig): BaseProvider {
  const decryptedConfig = { ...config };
  
  if (decryptedConfig.apiKey && decryptedConfig.apiKey.includes(":")) {
    try {
      decryptedConfig.apiKey = decrypt(decryptedConfig.apiKey);
    } catch (err) {
      logger.warn({ 
        provider: config.name, 
        err: (err as Error).message 
      }, "Just-in-time decryption failed (might be raw)");
    }
  }

  if (!config.type) {
    throw new Error("missing required 'type' field");
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

  if (!["api", "local", "rpa"].includes(type)) {
    throw new Error(`invalid type '${type}'. Must be 'api', 'local', or 'rpa'`);
  }
  const lowerName = (decryptedConfig.name || "").toLowerCase();
  const lowerModel = (decryptedConfig.model || "").toLowerCase();

  if (type === "openai" || type === "openai-compat") return new OpenAIProvider(decryptedConfig);
  if (type === "anthropic") return new AnthropicProvider(decryptedConfig);
  if (type === "google")    return new GoogleProvider(decryptedConfig);
  if (type === "ollama")    return new OllamaProvider(decryptedConfig);
  if (type === "rpa")       return new RPAProvider(decryptedConfig);

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
      if (lowerName.includes("google") || lowerModel.includes("gemini")) return new GoogleProvider(decryptedConfig);
      if (lowerName.includes("anthropic") || lowerModel.includes("claude")) return new AnthropicProvider(decryptedConfig);
      if (lowerName.includes("openai") || type === "") return new OpenAIProvider(decryptedConfig);
      
      throw new Error(`Unsupported provider type: ${decryptedConfig.type}`);
  }
}
