import logger from "./logger.js";

/**
 * P9-82: Structured error result with clear field semantics:
 * - `httpStatus`: always a numeric HTTP status code (e.g., 429, 500)
 * - `errorCode`: always a machine-readable string (e.g., "RATE_LIMITED", "AUTH_FAILED")
 * - `message`: human-readable message for the end user
 * - `retryable`: whether the caller should retry (P9-84)
 * - `retryAfterMs`: optional hint for retry delay in milliseconds (P9-85)
 * - `metadata`: structured fields from the provider error (P9-85)
 */
export interface MappedError {
  httpStatus: number;
  errorCode: string;
  message: string;
  retryable: boolean;
  retryAfterMs?: number;
  metadata?: Record<string, unknown>;
}

/**
 * Extract a numeric HTTP status code from an error object.
 * Many provider SDKs attach status/statusCode directly on the error.
 */
function getStatusCode(err: unknown): number | undefined {
  if (typeof err === "object" && err !== null) {
    const e = err as Record<string, unknown>;
    for (const key of ["status", "statusCode", "status_code"]) {
      const val = e[key];
      if (typeof val === "number" && val >= 100 && val < 600) return val;
    }
    // P9-82: Only use `code` if it's numeric (not a string error type)
    if (typeof e.code === "number" && e.code >= 100 && e.code < 600) return e.code;
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
    // Direct fields — only string-typed `code` (P9-82: avoid conflict with numeric status)
    for (const key of ["type", "error_type"]) {
      if (typeof e[key] === "string") return (e[key] as string).toLowerCase();
    }
    if (typeof e.code === "string") return (e.code as string).toLowerCase();
    // Nested error object (common in OpenAI / Anthropic SDK responses)
    if (typeof e.error === "object" && e.error !== null) {
      const inner = e.error as Record<string, unknown>;
      if (typeof inner.type === "string") return (inner.type as string).toLowerCase();
      if (typeof inner.code === "string") return (inner.code as string).toLowerCase();
    }
  }
  return undefined;
}

// P9-85: Extract structured metadata from provider error (retry-after, rate limit info)
function extractMetadata(err: unknown): { retryAfterMs?: number; metadata?: Record<string, unknown> } {
  if (typeof err !== "object" || err === null) return {};

  const e = err as Record<string, unknown>;
  const metadata: Record<string, unknown> = {};
  let retryAfterMs: number | undefined;

  // Extract retry-after from headers or direct fields
  const headers = (e.headers ?? (e.response as Record<string, unknown> | undefined)?.headers) as Record<string, unknown> | undefined;
  if (headers) {
    const retryAfter = headers["retry-after"] ?? headers["Retry-After"];
    if (typeof retryAfter === "string") {
      const seconds = parseFloat(retryAfter);
      if (!isNaN(seconds)) retryAfterMs = Math.ceil(seconds * 1000);
    } else if (typeof retryAfter === "number") {
      retryAfterMs = retryAfter * 1000;
    }

    // Rate limit headers
    const remaining = headers["x-ratelimit-remaining"] ?? headers["X-RateLimit-Remaining"];
    if (remaining !== undefined) metadata.rateLimitRemaining = remaining;
    const reset = headers["x-ratelimit-reset"] ?? headers["X-RateLimit-Reset"];
    if (reset !== undefined) metadata.rateLimitReset = reset;
  }

  // Direct retry_after field (some SDKs)
  if (typeof e.retry_after === "number") retryAfterMs = e.retry_after * 1000;
  if (typeof e.retryAfter === "number") retryAfterMs = e.retryAfter * 1000;

  // Provider-specific fields
  if (e.request_id) metadata.requestId = e.request_id;
  if ((e as Record<string, unknown>).error && typeof (e as Record<string, unknown>).error === "object") {
    const inner = (e as Record<string, unknown>).error as Record<string, unknown>;
    if (inner.param) metadata.param = inner.param;
  }

  return {
    retryAfterMs,
    metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
  };
}

const messageLower = (err: unknown): string => {
  const error = err as Error;
  return (error.message || String(err)).toLowerCase();
};

/**
 * Map a provider error to a structured MappedError.
 *
 * Classification priority (PRV-12):
 *   1. Structured fields — status code, error type/code (most reliable)
 *   2. String matching on message text (fallback for unstructured errors)
 *
 * P9-83: Status codes are now semantically correct:
 *   - 429 for rate limiting (not 403)
 *   - 401 for auth failures (not 403)
 *   - 402 only for actual billing/quota issues
 *   - 503 for provider overload (not 500)
 */
export function mapProviderErrorStructured(err: unknown): MappedError {
  if (!err) return { httpStatus: 500, errorCode: "UNKNOWN", message: "Unknown error occurred", retryable: false };

  const status = getStatusCode(err);
  const errType = getErrorType(err);
  const msg = messageLower(err);
  const { retryAfterMs, metadata } = extractMetadata(err);

  // --- Rate limiting --- (P9-84: retryable)
  if (status === 429
    || errType === "rate_limit_error"
    || errType === "rate_limit_exceeded"
    || msg.includes("rate limit") || msg.includes("too many requests")) {
    return {
      httpStatus: 429,
      errorCode: "RATE_LIMITED",
      message: "Rate limit exceeded. Please try again in a moment.",
      retryable: true,
      retryAfterMs: retryAfterMs ?? 5000,
      metadata,
    };
  }

  // --- Authentication --- (P9-83: Use 401, not 403)
  if (status === 401
    || errType === "authentication_error"
    || errType === "invalid_api_key"
    || msg.includes("unauthorized") || msg.includes("invalid api key")) {
    return {
      httpStatus: 401,
      errorCode: "AUTH_FAILED",
      message: "Authentication failed. Please check your API key.",
      retryable: false,
      metadata,
    };
  }

  // --- Permission --- (P9-83: 403 only for actual permission denied)
  if (status === 403
    || errType === "permission_error"
    || msg.includes("forbidden") || msg.includes("permission denied")) {
    return {
      httpStatus: 403,
      errorCode: "PERMISSION_DENIED",
      message: "Access denied. Insufficient permissions.",
      retryable: false,
      metadata,
    };
  }

  // --- Billing / quota --- (P9-83: 402 correctly for payment issues)
  if (status === 402
    || errType === "insufficient_quota"
    || errType === "billing_error"
    || msg.includes("quota") || msg.includes("billing") || msg.includes("insufficient funds")) {
    return {
      httpStatus: 402,
      errorCode: "QUOTA_EXCEEDED",
      message: "API quota exceeded. Please check your billing settings.",
      retryable: false,
      metadata,
    };
  }

  // --- Not found (model or endpoint) ---
  if (status === 404
    || errType === "not_found_error"
    || errType === "model_not_found"
    || errType === "invalid_model"
    || (msg.includes("not found") && msg.includes("model"))) {
    return {
      httpStatus: 404,
      errorCode: "MODEL_NOT_FOUND",
      message: "Model not found. Please check the model name.",
      retryable: false,
      metadata,
    };
  }

  // --- Content / safety filters ---
  if (errType === "content_filter"
    || errType === "content_policy_violation"
    || errType === "safety_error"
    || msg.includes("content filter") || msg.includes("safety") || msg.includes("content_policy")
    || msg.includes("blocked")) {
    return {
      httpStatus: 400,
      errorCode: "CONTENT_FILTERED",
      message: "Content was blocked by safety filters. Please rephrase your request.",
      retryable: false,
      metadata,
    };
  }

  // --- Timeout --- (P9-84: retryable)
  if (errType === "timeout"
    || msg.includes("timeout") || msg.includes("etimedout") || msg.includes("econnaborted")) {
    return {
      httpStatus: 504,
      errorCode: "TIMEOUT",
      message: "Request timed out. The model may be overloaded.",
      retryable: true,
      retryAfterMs: retryAfterMs ?? 3000,
      metadata,
    };
  }

  // --- Server errors (5xx) --- (P9-84: retryable, P9-83: 503 for overload)
  if (status !== undefined && status >= 500 && status < 600) {
    return {
      httpStatus: 503,
      errorCode: "PROVIDER_UNAVAILABLE",
      message: "The AI service is temporarily unavailable. Please try again.",
      retryable: true,
      retryAfterMs: retryAfterMs ?? 5000,
      metadata,
    };
  }
  if (errType === "server_error" || errType === "overloaded_error" || errType === "api_error"
    || msg.includes("internal server error") || msg.includes("bad gateway")
    || msg.includes("service unavailable")) {
    return {
      httpStatus: 503,
      errorCode: "PROVIDER_UNAVAILABLE",
      message: "The AI service is temporarily unavailable. Please try again.",
      retryable: true,
      retryAfterMs: retryAfterMs ?? 5000,
      metadata,
    };
  }

  // --- Network errors --- (P9-84: retryable)
  if (msg.includes("enotfound") || msg.includes("econnrefused") || msg.includes("econnreset")
    || msg.includes("network") || msg.includes("fetch failed")) {
    return {
      httpStatus: 502,
      errorCode: "NETWORK_ERROR",
      message: "Network error. Please check your connection.",
      retryable: true,
      retryAfterMs: retryAfterMs ?? 2000,
      metadata,
    };
  }

  logger.warn({ err: (err as Error).message || String(err) }, "Unmapped provider error");

  return {
    httpStatus: 500,
    errorCode: "INTERNAL_ERROR",
    message: "An error occurred while processing your request. Please try again.",
    retryable: false,
    metadata,
  };
}

/**
 * Legacy API — returns just the user-facing message string.
 * Use mapProviderErrorStructured() for full classification.
 */
export function mapProviderError(err: unknown): string {
  return mapProviderErrorStructured(err).message;
}
