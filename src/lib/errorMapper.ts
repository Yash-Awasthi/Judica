export const ERROR_DICTIONARY = {
  RATE_LIMIT: "Rate limit exceeded. Please try again in a few moments.",
  AUTH_401: "Authentication failed. The AI provider rejected the credentials.",
  QUOTA_EXCEEDED: "Quota exceeded. Billing limits have been reached for this provider.",
  MODEL_NOT_FOUND: "Model not found. The requested model is either unavailable or unauthorized.",
  CONTEXT_LENGTH: "Context length exceeded. The conversation is too long for this model.",
  NETWORK_TIMEOUT: "Network timeout. The AI provider took too long to respond.",
  UNKNOWN: "An unknown error occurred while communicating with the AI provider."
} as const;

export type ProviderService = "OpenAI" | "Anthropic" | "Google" | "NIM" | "Unknown";

export function mapProviderError(error: unknown): string {
  try {
    if (!error) return ERROR_DICTIONARY.UNKNOWN;
    
    // Convert to a string context or get the error message
    const msg = error instanceof Error ? error.message : String(error);
    const lowMsg = msg.toLowerCase();
    
    // Auth & 401
    if (lowMsg.includes("401") || lowMsg.includes("unauthorized") || lowMsg.includes("invalid api key") || lowMsg.includes("authentication_error")) {
      return ERROR_DICTIONARY.AUTH_401;
    }
    
    // Quota Exceeded & Billing
    if (lowMsg.includes("quota") || lowMsg.includes("billing") || lowMsg.includes("out of credits") || lowMsg.includes("insufficient_quota")) {
      return ERROR_DICTIONARY.QUOTA_EXCEEDED;
    }
    
    // Rate Limiting (429)
    if (lowMsg.includes("429") || lowMsg.includes("rate limit") || lowMsg.includes("too many requests")) {
      return ERROR_DICTIONARY.RATE_LIMIT;
    }
    
    // Model Not Found (404 / 400 with model string)
    if (lowMsg.includes("model_not_found") || lowMsg.includes("does not exist") || (lowMsg.includes("404") && lowMsg.includes("model"))) {
      return ERROR_DICTIONARY.MODEL_NOT_FOUND;
    }
    
    // Context Length Exceeded
    if (lowMsg.includes("maximum context length") || lowMsg.includes("context_length_exceeded") || lowMsg.includes("too long")) {
      return ERROR_DICTIONARY.CONTEXT_LENGTH;
    }
    
    // Network Timeout (504, 524, timeout string)
    if (lowMsg.includes("timeout") || lowMsg.includes("504") || lowMsg.includes("524") || lowMsg.includes("econnreset") || lowMsg.includes("etimedout")) {
      return ERROR_DICTIONARY.NETWORK_TIMEOUT;
    }
    
    // Fallback to presenting the provider's specific error message if it doesn't match keys,
    // safely stripping overly technical stacks (heuristic: returning just the message string).
    return msg.length < 200 ? msg : ERROR_DICTIONARY.UNKNOWN;
  } catch (err) {
    // Must never throw
    return ERROR_DICTIONARY.UNKNOWN;
  }
}
