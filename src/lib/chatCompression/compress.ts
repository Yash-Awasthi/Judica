/**
 * Chat Compression — progressive summarization engine.
 *
 * Modeled after Onyx chat/compression.py:
 * 1. Estimate token count of current history
 * 2. If exceeds triggerRatio × contextWindowTokens, compress
 * 3. Split into older (to be summarized) and recent (kept verbatim)
 * 4. Batch-summarize older messages with LLM
 * 5. Replace older messages with summary messages
 * 6. Tool calls compacted to "[Used tools: tool1, tool2]"
 */

import { routeAndCollect } from "../../router/smartRouter.js";
import type { AdapterMessage } from "../../adapters/types.js";
import logger from "../logger.js";
import type {
  CompressionConfig,
  CompressionResult,
  CompressedSummary,
} from "./models.js";
import { DEFAULT_COMPRESSION_CONFIG } from "./models.js";

// ─── Main Entry Point ────────────────────────────────────────────────────────

/**
 * Compress chat history if it exceeds the context window threshold.
 * Returns the original messages unchanged if compression is not needed.
 */
export async function compressHistory(
  messages: AdapterMessage[],
  config: Partial<CompressionConfig> = {},
): Promise<CompressionResult> {
  const cfg: CompressionConfig = { ...DEFAULT_COMPRESSION_CONFIG, ...config };

  const tokensBefore = estimateMessageTokens(messages);
  const triggerThreshold = cfg.contextWindowTokens * cfg.triggerRatio;

  // No compression needed
  if (tokensBefore <= triggerThreshold) {
    return {
      compressed: false,
      originalCount: messages.length,
      compressedCount: messages.length,
      tokensBefore,
      tokensAfter: tokensBefore,
      messages,
      summaries: [],
    };
  }

  logger.info(
    { tokensBefore, threshold: triggerThreshold, messageCount: messages.length },
    "Chat compression triggered",
  );

  // Split into older (to compress) and recent (keep verbatim)
  const recentTokenBudget = cfg.contextWindowTokens * cfg.recentFraction;
  const { older, recent } = splitMessages(messages, recentTokenBudget);

  if (older.length === 0) {
    // All messages fit in the recent window — nothing to compress
    return {
      compressed: false,
      originalCount: messages.length,
      compressedCount: messages.length,
      tokensBefore,
      tokensAfter: tokensBefore,
      messages,
      summaries: [],
    };
  }

  // Batch-summarize older messages
  const batches = createBatches(older, cfg.batchSize);
  const summaries: CompressedSummary[] = [];
  const summaryMessages: AdapterMessage[] = [];

  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    const summary = await summarizeBatch(batch, i, cfg);
    summaries.push(summary);

    // Create a system message containing the summary
    summaryMessages.push({
      role: "system",
      content: `[Conversation Summary ${i + 1}/${batches.length}]\n${summary.summary}${
        summary.toolsUsed.length > 0
          ? `\n[Used tools: ${summary.toolsUsed.join(", ")}]`
          : ""
      }`,
    });
  }

  // Reconstruct: summaries + recent messages
  const compressedMessages = [...summaryMessages, ...recent];
  const tokensAfter = estimateMessageTokens(compressedMessages);

  logger.info(
    {
      tokensBefore,
      tokensAfter,
      reduction: `${Math.round((1 - tokensAfter / tokensBefore) * 100)}%`,
      batchesCompressed: batches.length,
      messagesCompressed: older.length,
      messagesKept: recent.length,
    },
    "Chat compression complete",
  );

  return {
    compressed: true,
    originalCount: messages.length,
    compressedCount: compressedMessages.length,
    tokensBefore,
    tokensAfter,
    messages: compressedMessages,
    summaries,
  };
}

// ─── Batch Summarization ─────────────────────────────────────────────────────

async function summarizeBatch(
  batch: AdapterMessage[],
  batchIndex: number,
  cfg: CompressionConfig,
): Promise<CompressedSummary> {
  // Extract tool usage from the batch
  const toolsUsed = new Set<string>();
  for (const msg of batch) {
    if (msg.tool_calls) {
      for (const tc of msg.tool_calls) {
        toolsUsed.add(tc.name);
      }
    }
    if (msg.role === "tool" && msg.name) {
      toolsUsed.add(msg.name);
    }
  }

  // Format messages for the summarizer
  const formatted = batch
    .map((m) => {
      const content = typeof m.content === "string"
        ? m.content
        : (m.content ?? []).map((b) => b.text || "").join("");

      // Compact tool calls
      if (m.tool_calls && m.tool_calls.length > 0) {
        const toolNames = m.tool_calls.map((tc) => tc.name).join(", ");
        return `${m.role}: ${content}\n[Called tools: ${toolNames}]`;
      }
      if (m.role === "tool") {
        return `tool(${m.name || "unknown"}): ${content.slice(0, 200)}...`;
      }
      return `${m.role}: ${content}`;
    })
    .join("\n\n");

  const result = await routeAndCollect(
    {
      model: cfg.summaryModel ?? "auto",
      messages: [
        {
          role: "system",
          content: SUMMARIZATION_PROMPT,
        },
        {
          role: "user",
          content: `Conversation segment to summarize:\n\n${formatted}`,
        },
      ],
      max_tokens: cfg.summaryMaxTokens,
      temperature: 0.3,
    },
    { tags: ["fast"] },
  );

  return {
    messageRange: { from: batchIndex * cfg.batchSize, to: batchIndex * cfg.batchSize + batch.length - 1 },
    summary: result.text,
    toolsUsed: Array.from(toolsUsed),
    tokensUsed: result.usage.prompt_tokens + result.usage.completion_tokens,
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Split messages into older (to compress) and recent (keep verbatim).
 * Preserves system messages at the start.
 * Walks backward from the end to fill the recent token budget.
 */
function splitMessages(
  messages: AdapterMessage[],
  recentTokenBudget: number,
): { older: AdapterMessage[]; recent: AdapterMessage[] } {
  // Always keep the first system message (if any)
  const firstSystemIdx = messages.findIndex((m) => m.role === "system");

  let recentTokens = 0;
  let splitIdx = messages.length;

  // Walk backward, accumulating tokens until we hit the budget
  for (let i = messages.length - 1; i >= 0; i--) {
    const tokens = estimateSingleMessageTokens(messages[i]);
    if (recentTokens + tokens > recentTokenBudget) {
      splitIdx = i + 1;
      break;
    }
    recentTokens += tokens;
  }

  // Ensure we don't split in the middle of a tool call sequence
  // (keep tool response with its preceding assistant message)
  while (splitIdx < messages.length && messages[splitIdx].role === "tool") {
    splitIdx--;
  }

  // Ensure at least some messages are kept recent
  if (splitIdx >= messages.length) {
    splitIdx = Math.max(0, messages.length - 4);
  }

  const older = messages.slice(0, splitIdx);
  const recent = messages.slice(splitIdx);

  // If first message was a system message, move it to recent (don't summarize it)
  if (firstSystemIdx >= 0 && firstSystemIdx < splitIdx) {
    const sysMsg = older.splice(firstSystemIdx, 1)[0];
    recent.unshift(sysMsg);
  }

  return { older, recent };
}

function createBatches(messages: AdapterMessage[], batchSize: number): AdapterMessage[][] {
  const batches: AdapterMessage[][] = [];
  for (let i = 0; i < messages.length; i += batchSize) {
    batches.push(messages.slice(i, i + batchSize));
  }
  return batches;
}

/**
 * Rough token estimation — ~4 chars per token (English average).
 * Good enough for compression trigger decisions.
 */
function estimateMessageTokens(messages: AdapterMessage[]): number {
  return messages.reduce((sum, m) => sum + estimateSingleMessageTokens(m), 0);
}

function estimateSingleMessageTokens(msg: AdapterMessage): number {
  const content = typeof msg.content === "string"
    ? msg.content
    : (msg.content ?? []).map((b) => b.text || "").join("");

  let tokens = Math.ceil(content.length / 4);

  // Add overhead for tool calls
  if (msg.tool_calls) {
    for (const tc of msg.tool_calls) {
      const argStr = typeof tc.arguments === "string" ? tc.arguments : JSON.stringify(tc.arguments);
      tokens += Math.ceil((tc.name.length + argStr.length) / 4);
    }
  }

  // Role and formatting overhead
  tokens += 4;

  return tokens;
}

// ─── Prompts ─────────────────────────────────────────────────────────────────

const SUMMARIZATION_PROMPT = `Summarize the following conversation segment concisely while preserving:
- Key decisions and conclusions
- Important facts and data points mentioned
- The overall direction and intent of the conversation
- Any action items or commitments

Do NOT include:
- Greetings, small talk, or filler
- Redundant repetitions of the same point
- Full tool call arguments (just mention which tools were used)

Keep the summary factual and concise. Use bullet points for clarity.
Output only the summary, no preamble.`;
