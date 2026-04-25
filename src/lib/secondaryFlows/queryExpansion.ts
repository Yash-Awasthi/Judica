/**
 * Query Expansion — semantic rephrase + keyword extraction for better search.
 *
 * Modeled after Onyx secondary_llm_flows/query_expansion.py.
 * Takes a user query and produces up to 3 expanded queries:
 * 1. Semantic rephrase (different wording, same intent)
 * 2. Keyword extraction (key terms for keyword search)
 * 3. Optional broader/narrower framing
 */

import { routeAndCollect } from "../../router/smartRouter.js";
import type { AdapterMessage } from "../../adapters/types.js";
import logger from "../logger.js";

export interface ExpandedQueries {
  /** Original query. */
  original: string;
  /** Semantically rephrased query. */
  rephrased: string;
  /** Extracted keywords for keyword search. */
  keywords: string[];
  /** All queries to run (original + expansions, max 3). */
  queries: string[];
}

const EXPANSION_PROMPT = `Given a user's search query and optional conversation context, expand it for better search results.

Return a JSON object:
{
  "rephrased": "semantically equivalent but differently worded query",
  "keywords": ["key", "terms", "for", "keyword", "search"],
  "broader": "optional broader framing of the query (omit if not helpful)"
}

Focus on:
- Capturing the user's true intent (not just literal words)
- Including synonyms and related terms
- Considering the conversation context if provided

Return ONLY the JSON object, no other text.`;

/**
 * Expand a user query into multiple search-optimized variants.
 * Uses conversation history for context if available.
 */
export async function expandQuery(
  query: string,
  chatHistory?: AdapterMessage[],
  options: { model?: string; maxQueries?: number } = {},
): Promise<ExpandedQueries> {
  const maxQueries = options.maxQueries ?? 3;

  // Build context from recent chat history
  let context = "";
  if (chatHistory && chatHistory.length > 0) {
    const recent = chatHistory
      .filter((m) => m.role !== "system")
      .slice(-5)
      .map((m) => {
        const content = typeof m.content === "string"
          ? m.content
          : (m.content ?? []).map((b) => b.text || "").join("");
        return `${m.role}: ${content.slice(0, 150)}`;
      })
      .join("\n");
    context = `\n\nConversation context:\n${recent}`;
  }

  try {
    const result = await routeAndCollect(
      {
        model: options.model ?? "auto",
        messages: [
          { role: "system", content: EXPANSION_PROMPT },
          { role: "user", content: `Query: ${query}${context}` },
        ],
        max_tokens: 200,
        temperature: 0.4,
      },
      { tags: ["fast", "cheap"] },
    );

    const parsed = JSON.parse(result.text);
    const queries = [query];

    if (parsed.rephrased && parsed.rephrased !== query) {
      queries.push(parsed.rephrased);
    }
    if (parsed.broader) {
      queries.push(parsed.broader);
    }

    return {
      original: query,
      rephrased: parsed.rephrased ?? query,
      keywords: parsed.keywords ?? [],
      queries: queries.slice(0, maxQueries),
    };
  } catch (err) {
    logger.warn({ err }, "Query expansion failed");
    return {
      original: query,
      rephrased: query,
      keywords: query.split(/\s+/).filter((w) => w.length > 3),
      queries: [query],
    };
  }
}
