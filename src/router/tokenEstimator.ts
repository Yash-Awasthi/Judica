import type { AdapterMessage } from "../adapters/types.js";

// P9-66: Token estimation uses character-based heuristics (NOT actual provider billing).
// Actual billed tokens come from provider API responses (`usage.prompt_tokens`, etc.).
// This estimator is used PRE-FLIGHT for quota checks and routing decisions only.
// Post-flight, always prefer the actual token counts from the provider response.
//
// Estimate token count before sending to avoid exceeding quotas.
// Uses character-based heuristics with language-aware adjustments (PRV-11).

// CJK Unified Ideographs and common CJK ranges
const CJK_REGEX = /[\u2E80-\u9FFF\uF900-\uFAFF\uFE30-\uFE4F\u{20000}-\u{2FA1F}]/u;

/**
 * Estimate tokens for a single string, adjusting for non-ASCII / CJK text.
 *
 * - English / Latin text: ~4 chars per token (standard BPE behaviour).
 * - CJK text (Chinese, Japanese kanji, Korean hanja): each character is
 *   roughly 1-2 tokens, so we use a ratio of ~1.5 chars per token.
 * - Other non-ASCII (Cyrillic, Arabic, Devanagari, emoji, etc.) tends to
 *   tokenise at ~2 chars per token.
 *
 * We classify by sampling the string and blending the ratios.
 */
export function estimateStringTokens(text: string): number {
  if (text.length === 0) return 0;

  let asciiChars = 0;
  let cjkChars = 0;
  let otherNonAsciiChars = 0;

  for (const ch of text) {
    const code = ch.codePointAt(0)!;
    if (code <= 0x7f) {
      asciiChars++;
    } else if (CJK_REGEX.test(ch)) {
      cjkChars++;
    } else {
      otherNonAsciiChars++;
    }
  }

  // Estimate tokens per category
  const asciiTokens = asciiChars / 4;
  const cjkTokens = cjkChars / 1.5; // each CJK char ~ 1-2 tokens
  const otherTokens = otherNonAsciiChars / 2;

  return Math.ceil(asciiTokens + cjkTokens + otherTokens);
}

/**
 * Estimate total tokens for a set of messages.
 */
export function estimateTokens(messages: AdapterMessage[]): number {
  let totalTokens = 0;

  for (const m of messages) {
    if (typeof m.content === "string") {
      totalTokens += estimateStringTokens(m.content);
    } else if (Array.isArray(m.content)) {
      for (const block of m.content) {
        if (block.text) totalTokens += estimateStringTokens(block.text);
        // Images are ~85 tokens for low-res, ~765 for high-res. Use 200 as average.
        if (block.type === "image_base64" || block.type === "image_url") totalTokens += 200;
      }
    }

    // Tool calls add overhead
    // P43-07: Cap tool calls and argument size to prevent DoS
    if (m.tool_calls) {
      for (const tc of m.tool_calls.slice(0, 100)) {
        const argStr = JSON.stringify(tc.arguments);
        totalTokens += estimateStringTokens(tc.name + (argStr.length > 100_000 ? argStr.slice(0, 100_000) : argStr));
      }
    }
  }

  // Add overhead for message framing
  return totalTokens + messages.length * 4;
}
