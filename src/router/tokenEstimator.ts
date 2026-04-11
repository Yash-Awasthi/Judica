import type { AdapterMessage } from "../adapters/types.js";

// ─── Token Estimator ─────────────────────────────────────────────────────────
// Estimate token count before sending to avoid exceeding quotas.
// Uses heuristic (chars/4) — accurate enough for quota decisions.

/**
 * Estimate total tokens for a set of messages.
 * This is a rough estimate: ~4 chars per token for English text.
 */
export function estimateTokens(messages: AdapterMessage[]): number {
  let totalChars = 0;

  for (const m of messages) {
    if (typeof m.content === "string") {
      totalChars += m.content.length;
    } else if (Array.isArray(m.content)) {
      for (const block of m.content) {
        if (block.text) totalChars += block.text.length;
        // Images are ~85 tokens for low-res, ~765 for high-res. Use 200 as average.
        if (block.type === "image_base64" || block.type === "image_url") totalChars += 800;
      }
    }

    // Tool calls add overhead
    if (m.tool_calls) {
      for (const tc of m.tool_calls) {
        totalChars += tc.name.length + JSON.stringify(tc.arguments).length;
      }
    }
  }

  // ~4 chars per token, plus overhead for message framing
  return Math.ceil(totalChars / 4) + messages.length * 4;
}

/**
 * Estimate tokens for a single string.
 */
export function estimateStringTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
