import { BaseProvider } from "./baseProvider.js";
import { ProviderConfig } from "./types.js";
import { OpenAIProvider } from "./concrete/openai.js";
import { AnthropicProvider } from "./concrete/anthropic.js";
import { GoogleProvider } from "./concrete/google.js";
import { OllamaProvider } from "./concrete/ollama.js";
import { RPAProvider } from "./concrete/rpa.js";
import { decrypt } from "../crypto.js";
import logger from "../logger.js";

/**
 * Provider Factory - Enforces per-request instantiation to prevent state leakage.
 * Decision: Just-in-time decryption and robust provider matching.
 */
export function createProvider(config: ProviderConfig): BaseProvider {
  // Decision: Just-in-time decryption of API keys from storage
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

  // 1. Explicit provider detection (Issue 1 fallback)
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

  // 2. Legacy/Heuristic detection (fallback for older/missing configs)
  const type = (decryptedConfig.type || "").toLowerCase();

  if (!["api", "local", "rpa"].includes(type)) {
    throw new Error(`invalid type '${type}'. Must be 'api', 'local', or 'rpa'`);
  }
  const lowerName = (decryptedConfig.name || "").toLowerCase();
  const lowerModel = (decryptedConfig.model || "").toLowerCase();

  // If type is a specific provider name, use it
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
      // Last resort: try heuristic matching on name/model if type is unknown
      if (lowerName.includes("google") || lowerModel.includes("gemini")) return new GoogleProvider(decryptedConfig);
      if (lowerName.includes("anthropic") || lowerModel.includes("claude")) return new AnthropicProvider(decryptedConfig);
      if (lowerName.includes("openai") || type === "") return new OpenAIProvider(decryptedConfig);
      
      throw new Error(`Unsupported provider type: ${decryptedConfig.type}`);
  }
}
