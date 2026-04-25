/**
 * Chat Compression Models — progressive summarization for long conversations.
 *
 * Modeled after Onyx's chat/compression.py:
 * - Triggers when history tokens exceed a ratio of available context
 * - Splits messages into older (summarized) and recent (kept verbatim)
 * - Summaries stored as linked ChatMessage entries
 * - Tool calls compacted to "[Used tools: ...]" in summaries
 * - Branch-aware: tracks parent_message_id chains
 */

import type { AdapterMessage } from "../../adapters/types.js";

// ─── Configuration ───────────────────────────────────────────────────────────

export interface CompressionConfig {
  /** Ratio of context window that triggers compression (default: 0.75). */
  triggerRatio: number;
  /** Fraction of token budget reserved for recent messages (default: 0.2). */
  recentFraction: number;
  /** Max messages per summarization batch (default: 15). */
  batchSize: number;
  /** Model to use for summarization. */
  summaryModel?: string;
  /** Max tokens for each summary generation. */
  summaryMaxTokens: number;
  /** Available context window tokens (model-dependent). */
  contextWindowTokens: number;
}

export const DEFAULT_COMPRESSION_CONFIG: CompressionConfig = {
  triggerRatio: 0.75,
  recentFraction: 0.2,
  batchSize: 15,
  summaryMaxTokens: 500,
  contextWindowTokens: 128_000, // Default to 128K models
};

// ─── Compression Result ──────────────────────────────────────────────────────

export interface CompressionResult {
  /** Whether compression was actually performed. */
  compressed: boolean;
  /** Original message count. */
  originalCount: number;
  /** Final message count after compression. */
  compressedCount: number;
  /** Estimated tokens before compression. */
  tokensBefore: number;
  /** Estimated tokens after compression. */
  tokensAfter: number;
  /** The compressed message array. */
  messages: AdapterMessage[];
  /** Summaries generated (one per batch). */
  summaries: CompressedSummary[];
}

export interface CompressedSummary {
  /** Messages that were summarized (by index range). */
  messageRange: { from: number; to: number };
  /** The generated summary text. */
  summary: string;
  /** Tools that were used in the summarized messages. */
  toolsUsed: string[];
  /** Token cost of generating this summary. */
  tokensUsed: number;
}

// ─── Compressed Message ──────────────────────────────────────────────────────

export interface CompressedMessage {
  /** Original message ID (if tracked). */
  originalMessageId?: string;
  /** Parent message ID for branch tracking. */
  parentMessageId?: string;
  /** ID of the last message included in this summary. */
  lastSummarizedMessageId?: string;
  /** The summary content. */
  content: string;
  /** Whether this is a compression summary (vs original message). */
  isSummary: boolean;
}
