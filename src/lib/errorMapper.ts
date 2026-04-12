import logger from "./logger.js";

/**
 * Extract a numeric HTTP status code from an error object.
 * Many provider SDKs attach status/statusCode directly on the error.
 */
function getStatusCode(err: unknown): number | undefined {
  if (typeof err === "object" && err !== null) {
    const e = err as Record<string, unknown>;
    for (const key of ["status", "statusCode", "status_code", "code"]) {
      const val = e[key];
      if (typeof val === "number" && val >= 100 && val < 600) return val;
    }
    // Some SDKs nest it under response
    if (typeof e.response === "object" && e.response !== null) {
      const resp = e.response as Record<string, unknown>;
      if (typeof resp.status === "number") return resp.status;
    }
  }
  return undefined;
}

/**
 * Extract a machine-readable error type/code string from an error object.
 * Provider SDKs often include fields like `error.type`, `error.code`, or
 * `error.error.type` with values such as "rate_limit_error", "invalid_api_key".
 */
function getErrorType(err: unknown): string | undefined {
  if (typeof err === "object" && err !== null) {
    const e = err as Record<string, unknown>;
    // Direct fields
    for (const key of ["type", "error_type", "code"]) {
      if (typeof e[key] === "string") return (e[key] as string).toLowerCase();
    }
    // Nested error object (common in OpenAI / Anthropic SDK responses)
    if (typeof e.error === "object" && e.error !== null) {
      const inner = e.error as Record<string, unknown>;
      if (typeof inner.type === "string") return (inner.type as string).toLowerCase();
      if (typeof inner.code === "string") return (inner.code as string).toLowerCase();
    }
  }
  return undefined;
}

const messageLower = (err: unknown): string => {
  const error = err as Error;
  return (error.message || String(err)).toLowerCase();
};

/**
 * Map a provider error to a user-friendly message.
 *
 * Classification priority (PRV-12):
 *   1. Structured fields — status code, error type/code (most reliable)
 *   2. String matching on message text (fallback for unstructured errors)
 */
export function mapProviderError(err: unknown): string {
  if (!err) return "Unknown error occurred";

  const status = getStatusCode(err);
  const errType = getErrorType(err);
  const msg = messageLower(err);

  // --- Rate limiting ---
  if (status === 429
    || errType === "rate_limit_error"
    || errType === "rate_limit_exceeded"
    || msg.includes("rate limit") || msg.includes("too many requests")) {
    return "Rate limit exceeded. Please try again in a moment.";
  }

  // --- Authentication ---
  if (status === 401 || status === 403
    || errType === "authentication_error"
    || errType === "invalid_api_key"
    || errType === "permission_error"
    || msg.includes("unauthorized") || msg.includes("invalid api key") || msg.includes("forbidden")) {
    return "Authentication failed. Please check your API key.";
  }

  // --- Billing / quota ---
  if (status === 402
    || errType === "insufficient_quota"
    || errType === "billing_error"
    || msg.includes("quota") || msg.includes("billing") || msg.includes("insufficient funds")) {
    return "API quota exceeded. Please check your billing settings.";
  }

  // --- Not found (model or endpoint) ---
  if (status === 404
    || errType === "not_found_error"
    || errType === "model_not_found"
    || errType === "invalid_model"
    || (msg.includes("not found") && msg.includes("model"))) {
    return "Model not found. Please check the model name.";
  }

  // --- Content / safety filters ---
  if (errType === "content_filter"
    || errType === "content_policy_violation"
    || errType === "safety_error"
    || msg.includes("content filter") || msg.includes("safety") || msg.includes("content_policy")
    || msg.includes("blocked")) {
    return "Content was blocked by safety filters. Please rephrase your request.";
  }

  // --- Timeout ---
  if (errType === "timeout"
    || msg.includes("timeout") || msg.includes("etimedout") || msg.includes("econnaborted")) {
    return "Request timed out. The model may be overloaded.";
  }

  // --- Server errors (5xx) ---
  if (status !== undefined && status >= 500 && status < 600) {
    return "The AI service is temporarily unavailable. Please try again.";
  }
  if (errType === "server_error" || errType === "overloaded_error" || errType === "api_error"
    || msg.includes("internal server error") || msg.includes("bad gateway")
    || msg.includes("service unavailable")) {
    return "The AI service is temporarily unavailable. Please try again.";
  }

  // --- Network errors ---
  if (msg.includes("enotfound") || msg.includes("econnrefused") || msg.includes("econnreset")
    || msg.includes("network") || msg.includes("fetch failed")) {
    return "Network error. Please check your connection.";
  }

  logger.warn({ err: (err as Error).message || String(err) }, "Unmapped provider error");

  return "An error occurred while processing your request. Please try again.";
}