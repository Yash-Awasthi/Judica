import logger from "./logger.js";
import { getAdapterOrNull } from "../adapters/registry.js";

/**
 * Generates 2-3 rephrasings of a query to improve retrieval recall.
 * Uses cheapest available model. Falls back to [query] on any error.
 */
export async function expandQuery(query: string, count: number = 3): Promise<string[]> {
  // Short queries don't benefit from expansion
  if (query.trim().length < 10) {
    return [query];
  }

  // Pick cheapest available adapter in preference order
  const CHEAP_MODELS: Array<{ provider: string; model: string }> = [
    { provider: "groq", model: "llama-3.1-8b-instant" },
    { provider: "openai", model: "gpt-4o-mini" },
    { provider: "gemini", model: "gemini-1.5-flash" },
    { provider: "anthropic", model: "claude-3-haiku-20240307" },
  ];

  let adapter = null;
  let model = "";

  for (const candidate of CHEAP_MODELS) {
    const a = getAdapterOrNull(candidate.provider);
    if (a) {
      adapter = a;
      model = candidate.model;
      break;
    }
  }

  if (!adapter) {
    logger.debug("queryExpansion: no LLM adapter available, skipping expansion");
    return [query];
  }

  const prompt =
    `Rephrase this search query ${count} different ways. Return JSON array of strings only, no explanation. Query: ${query}`;

  try {
    const result = await adapter.generate({
      model,
      messages: [{ role: "user", content: prompt }],
      max_tokens: 256,
    });

    const collected = await result.collect();
    const text = collected.text.trim();

    // Extract JSON array from the response — handle markdown fences
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      logger.warn({ text: text.substring(0, 200) }, "queryExpansion: no JSON array found in response");
      return [query];
    }

    const parsed: unknown = JSON.parse(jsonMatch[0]);
    if (!Array.isArray(parsed)) {
      return [query];
    }

    const variants = parsed
      .filter((v): v is string => typeof v === "string" && v.trim().length > 0)
      .slice(0, count);

    if (variants.length === 0) {
      return [query];
    }

    // Prepend the original query so it is always the first candidate
    return [query, ...variants];
  } catch (err) {
    logger.warn({ err, query: query.substring(0, 80) }, "queryExpansion: LLM call failed, falling back to original query");
    return [query];
  }
}
