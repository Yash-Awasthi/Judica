/**
 * P10-136: Central Input Sanitization Layer
 *
 * Provides a unified defense against injection attacks across all surfaces:
 * - Prompt injection (LLM nodes)
 * - Template injection (template nodes)
 * - Command injection (code nodes)
 * - Header injection (HTTP nodes)
 * - Prototype pollution (merge/split nodes)
 *
 * All node handlers should pass untrusted input through this layer before use.
 */

// P10-138: Dangerous keys that enable prototype pollution
const PROTOTYPE_POLLUTION_KEYS = new Set([
  "__proto__",
  "constructor",
  "prototype",
  "__defineGetter__",
  "__defineSetter__",
  "__lookupGetter__",
  "__lookupSetter__",
]);

/**
 * P10-136: Strip prototype-polluting keys from any object recursively.
 * Prevents pollution from propagating through workflow state.
 */
export function sanitizeObject(obj: unknown, depth = 0): unknown {
  if (depth > 20) return obj; // Prevent infinite recursion
  if (obj === null || obj === undefined) return obj;
  if (typeof obj !== "object") return obj;

  if (Array.isArray(obj)) {
    return obj.map(item => sanitizeObject(item, depth + 1));
  }

  const clean: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    if (PROTOTYPE_POLLUTION_KEYS.has(key)) continue;
    clean[key] = sanitizeObject(value, depth + 1);
  }
  return clean;
}

/**
 * P10-136: Sanitize string content that will be used in prompts.
 * Strips common prompt injection patterns without breaking legitimate content.
 */
export function sanitizeForPrompt(text: string): string {
  if (typeof text !== "string") return String(text ?? "");
  return text
    // Neutralize role-switching attempts
    .replace(/^(system|assistant|user)\s*:/gim, "[$1]:")
    // Escape markdown code blocks that could confuse prompt parsing
    .replace(/```/g, "\\`\\`\\`")
    // Strip ANSI escape sequences
    .replace(/\x1b\[[0-9;]*m/g, "");
}

/**
 * P10-136: Sanitize content for use in templates.
 * Escapes template delimiters to prevent template injection.
 */
export function sanitizeForTemplate(text: string): string {
  if (typeof text !== "string") return String(text ?? "");
  return text
    .replace(/\{\{/g, "\\{\\{")
    .replace(/\}\}/g, "\\}\\}");
}

/**
 * P10-136: Validate HTTP headers for injection safety.
 */
export function sanitizeHeaders(headers: Record<string, string>): Record<string, string> {
  const clean: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    // P10-102/P10-137: Reject headers with newlines (HTTP header injection)
    if (/[\r\n\0]/.test(key) || /[\r\n\0]/.test(value)) continue;
    clean[key] = value;
  }
  return clean;
}

/**
 * P10-139: Sanitize code node output before passing to downstream LLM/template nodes.
 * Prevents sandbox escape via crafted output that gets interpreted as code.
 */
export function sanitizeCodeOutput(output: string): string {
  if (typeof output !== "string") return String(output ?? "");
  // Cap length to prevent DoS
  const capped = output.length > 1_000_000 ? output.slice(0, 1_000_000) : output;
  return capped
    // Neutralize template-like patterns in output
    .replace(/\{\{/g, "{ {")
    .replace(/\}\}/g, "} }");
}

/**
 * P10-136: Apply appropriate sanitization based on source and target node types.
 */
export function sanitizeInterNodeData(
  data: Record<string, unknown>,
  sourceType: string,
  targetType: string
): Record<string, unknown> {
  // Always strip prototype pollution regardless of node types
  const clean = sanitizeObject(data) as Record<string, unknown>;

  // P10-139: Extra sanitization for code → LLM/template chains
  if (sourceType === "code" && (targetType === "llm" || targetType === "template")) {
    for (const [key, value] of Object.entries(clean)) {
      if (typeof value === "string") {
        clean[key] = sanitizeCodeOutput(value);
      }
    }
  }

  return clean;
}
