import logger from "./logger.js";

export function mapProviderError(err: unknown): string {
  if (!err) return "Unknown error occurred";

  const error = err as Error;
  const message = error.message || String(err);

  if (message.includes("429") || message.includes("rate limit") || message.includes("too many requests")) {
    return "Rate limit exceeded. Please try again in a moment.";
  }

  if (message.includes("401") || message.includes("unauthorized") || message.includes("invalid api key")) {
    return "Authentication failed. Please check your API key.";
  }

  if (message.includes("402") || message.includes("quota") || message.includes("billing")) {
    return "API quota exceeded. Please check your billing settings.";
  }

  if (message.includes("timeout") || message.includes("ETIMEDOUT") || message.includes("ECONNREFUSED")) {
    return "Request timed out. The model may be overloaded.";
  }

  if (message.includes("404") || message.includes("not found") || message.includes("model")) {
    return "Model not found. Please check the model name.";
  }

  if (message.includes("500") || message.includes("502") || message.includes("503") || message.includes("504")) {
    return "The AI service is temporarily unavailable. Please try again.";
  }

  if (message.includes("content filter") || message.includes("safety") || message.includes("blocked")) {
    return "Content was blocked by safety filters. Please rephrase your request.";
  }

  if (message.includes("ENOTFOUND") || message.includes("ECONNREFUSED") || message.includes("network")) {
    return "Network error. Please check your connection.";
  }

  logger.warn({ err: message }, "Unmapped provider error");

  return "An error occurred while processing your request. Please try again.";
}