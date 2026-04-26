/**
 * Hierarchical Memory Compression — Phase 2.1
 *
 * Compresses long conversation history into a hierarchical summary structure.
 * Older messages are progressively summarized; recent messages stay verbatim.
 *
 * Inspired by:
 * - MemoryBank (NeurIPS, zhongwanjun/MemoryBank) — hierarchical memory with
 *   time-decay and multi-level summarization
 * - LongMem (Tsinghua, Yijia Shao et al.) — side-network long-term memory
 *   via retrieval-augmented decoding
 *
 * Strategy:
 * - Level 0 (verbatim): last N turns (default: 6)
 * - Level 1 (summary): turns 7–30, summarized as bullet points
 * - Level 2 (digest): turns 31+, compressed to key facts
 *
 * The compressed memory is injected as a system context block.
 */

import { askProvider } from "./providers.js";
import type { Provider } from "./providers.js";
import logger from "./logger.js";

export interface ConversationTurn {
  question: string;
  verdict: string;
}

export interface CompressedMemory {
  verbatimTurns: ConversationTurn[];
  level1Summary: string | null;
  level2Digest: string | null;
  totalTurns: number;
}

const VERBATIM_WINDOW = 6;
const LEVEL1_MAX = 30;

const SUMMARIZE_PROMPT = (turns: ConversationTurn[], level: 1 | 2): string => {
  const turnText = turns.map((t, i) =>
    `Turn ${i + 1}: Q: ${t.question.slice(0, 300)}\nA: ${t.verdict.slice(0, 300)}`
  ).join("\n\n");

  if (level === 1) {
    return `Summarize these conversation turns as concise bullet points capturing the key topics, decisions, and context:\n\n${turnText}\n\nOutput: A bulleted list of 5–10 key points.`;
  }
  return `Compress these conversation turns into a brief digest of 3–5 sentences capturing only the most critical facts and decisions:\n\n${turnText}\n\nOutput: A short paragraph.`;
};

/**
 * Compress conversation history into hierarchical levels.
 * Returns a CompressedMemory object ready to inject as system context.
 */
export async function compressConversationHistory(
  turns: ConversationTurn[],
  provider?: Provider,
): Promise<CompressedMemory> {
  if (turns.length === 0) {
    return { verbatimTurns: [], level1Summary: null, level2Digest: null, totalTurns: 0 };
  }

  // Most recent N turns stay verbatim
  const verbatimTurns = turns.slice(-VERBATIM_WINDOW);
  const olderTurns = turns.slice(0, -VERBATIM_WINDOW);

  if (olderTurns.length === 0) {
    return { verbatimTurns, level1Summary: null, level2Digest: null, totalTurns: turns.length };
  }

  // Level 1: turns from verbatim cutoff back to LEVEL1_MAX
  const level1Turns = olderTurns.slice(-LEVEL1_MAX);
  let level1Summary: string | null = null;

  if (level1Turns.length > 0 && provider) {
    try {
      const response = await askProvider(provider, [
        { role: "user", content: SUMMARIZE_PROMPT(level1Turns, 1) },
      ]);
      level1Summary = response.text.trim();
    } catch (err) {
      logger.warn({ err }, "Level 1 memory compression failed");
      level1Summary = level1Turns.map(t => `• ${t.question.slice(0, 80)}`).join("\n");
    }
  } else if (level1Turns.length > 0) {
    // Heuristic fallback: truncated question list
    level1Summary = level1Turns.map(t => `• ${t.question.slice(0, 80)}`).join("\n");
  }

  // Level 2: turns before level1 window
  const level2Turns = olderTurns.slice(0, -LEVEL1_MAX);
  let level2Digest: string | null = null;

  if (level2Turns.length > 0 && provider) {
    try {
      const response = await askProvider(provider, [
        { role: "user", content: SUMMARIZE_PROMPT(level2Turns, 2) },
      ]);
      level2Digest = response.text.trim();
    } catch (err) {
      logger.warn({ err }, "Level 2 memory compression failed");
      level2Digest = `Earlier conversation covered ${level2Turns.length} turns on topics: ${
        [...new Set(level2Turns.map(t => t.question.split(/\s+/).slice(0, 4).join(" ")))].join(", ")
      }`;
    }
  }

  return { verbatimTurns, level1Summary, level2Digest, totalTurns: turns.length };
}

/**
 * Format compressed memory as a system context block for injection.
 */
export function formatCompressedMemory(memory: CompressedMemory): string {
  if (memory.totalTurns === 0) return "";

  const parts: string[] = ["[CONVERSATION MEMORY]"];

  if (memory.level2Digest) {
    parts.push(`Early context (${memory.totalTurns - Math.min(memory.totalTurns, 30)} turns ago):\n${memory.level2Digest}`);
  }

  if (memory.level1Summary) {
    parts.push(`Recent context:\n${memory.level1Summary}`);
  }

  parts.push("[END MEMORY]");
  return parts.join("\n\n");
}
