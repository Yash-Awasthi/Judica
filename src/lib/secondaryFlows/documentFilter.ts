/**
 * Document Filter — LLM-based relevance scoring for document sections.
 *
 * Modeled after Onyx secondary_llm_flows/document_filter.py.
 * Classifies document sections on a 0-3 relevance scale and selects
 * the most relevant sections for context injection.
 */

import { routeAndCollect } from "../../router/smartRouter.js";
import logger from "../logger.js";

export interface DocumentSection {
  id: string;
  title: string;
  content: string;
  source?: string;
}

export interface ScoredSection {
  section: DocumentSection;
  relevance: number; // 0-3
  reasoning: string;
}

export interface FilterResult {
  /** Sections sorted by relevance (highest first). */
  sections: ScoredSection[];
  /** Sections with relevance >= threshold. */
  relevant: ScoredSection[];
  /** Total sections evaluated. */
  totalEvaluated: number;
}

const FILTER_PROMPT = `Rate the relevance of each document section to the user's query on a scale of 0-3:
- 0: Not relevant at all
- 1: Slightly relevant, tangentially related
- 2: Moderately relevant, contains useful context
- 3: Highly relevant, directly answers part of the query

Query: {query}

Sections:
{sections}

Return a JSON array of objects:
[
  { "id": "section_id", "relevance": 2, "reasoning": "brief explanation" }
]

Be strict — most sections should score 0-1. Only score 2-3 for genuinely relevant content.`;

/**
 * Filter and score document sections by relevance to a query.
 */
export async function filterRelevantSections(
  query: string,
  sections: DocumentSection[],
  options: { model?: string; threshold?: number } = {},
): Promise<FilterResult> {
  const threshold = options.threshold ?? 2;

  if (sections.length === 0) {
    return { sections: [], relevant: [], totalEvaluated: 0 };
  }

  // Format sections for the prompt
  const formatted = sections
    .map((s, i) => `[${s.id}] ${s.title}\n${s.content.slice(0, 500)}`)
    .join("\n\n---\n\n");

  const prompt = FILTER_PROMPT
    .replace("{query}", query)
    .replace("{sections}", formatted);

  try {
    const result = await routeAndCollect(
      {
        model: options.model ?? "auto",
        messages: [
          { role: "system", content: prompt },
          { role: "user", content: "Score each section." },
        ],
        max_tokens: sections.length * 50,
        temperature: 0.2,
      },
      { tags: ["fast"] },
    );

    const scores: Array<{ id: string; relevance: number; reasoning: string }> = JSON.parse(result.text);
    const scoreMap = new Map(scores.map((s) => [s.id, s]));

    const scored: ScoredSection[] = sections.map((section) => {
      const score = scoreMap.get(section.id);
      return {
        section,
        relevance: score?.relevance ?? 0,
        reasoning: score?.reasoning ?? "",
      };
    });

    // Sort by relevance (highest first)
    scored.sort((a, b) => b.relevance - a.relevance);

    return {
      sections: scored,
      relevant: scored.filter((s) => s.relevance >= threshold),
      totalEvaluated: sections.length,
    };
  } catch (err) {
    logger.warn({ err }, "Document filtering failed");
    // Fallback: return all sections unscored
    return {
      sections: sections.map((s) => ({ section: s, relevance: 0, reasoning: "scoring failed" })),
      relevant: [],
      totalEvaluated: sections.length,
    };
  }
}
