/**
 * Intelligent Skill Selection — Phase 1.19
 *
 * Automatically selects relevant skills/tools from the user's library
 * based on the question content before sending to the council.
 *
 * Inspired by:
 * - AnythingLLM (MIT, Mintplex-Labs/anything-llm) — agent skill auto-selection
 *   with keyword/embedding matching against tool descriptions
 * - LangChain Tool Selection (MIT) — LLM-based tool relevance scoring
 *
 * Strategy: lightweight keyword overlap scoring between question and
 * skill descriptions/tags. No extra LLM call needed for the basic case.
 * Optional: pass SKILL_SELECTION_LLM=true to use LLM-based selection.
 */

import { db } from "./drizzle.js";
import { userSkills } from "../db/schema/marketplace.js";
import { openapiTools } from "../db/schema/openapiTools.js";
import { eq, and } from "drizzle-orm";

export interface SelectedSkill {
  id: string;
  name: string;
  description: string;
  type: "user_skill" | "openapi_tool";
  relevanceScore: number;
}

/** Tokenize text into lowercase keywords (strip stop words) */
function keywords(text: string): Set<string> {
  const stopWords = new Set([
    "a","an","the","is","are","was","were","be","been","being",
    "have","has","had","do","does","did","will","would","could","should",
    "may","might","can","i","you","we","they","it","this","that","what",
    "how","why","when","where","which","who","to","for","in","on","at",
    "with","by","from","of","and","or","but","not","also","just","about",
  ]);
  return new Set(
    text.toLowerCase()
      .replace(/[^\w\s]/g, " ")
      .split(/\s+/)
      .filter(w => w.length > 2 && !stopWords.has(w))
  );
}

/** Jaccard similarity between two keyword sets */
function jaccardScore(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const w of a) { if (b.has(w)) intersection++; }
  const union = a.size + b.size - intersection;
  return union > 0 ? intersection / union : 0;
}

/**
 * Select relevant skills for a question.
 * Returns top-N skills above threshold, sorted by relevance.
 */
export async function selectRelevantSkills(
  userId: number,
  question: string,
  topN = 5,
  threshold = 0.05,
): Promise<SelectedSkill[]> {
  const questionKws = keywords(question);

  const [skills, tools] = await Promise.all([
    db.select().from(userSkills).where(eq(userSkills.userId, userId)),
    db.select().from(openapiTools).where(and(eq(openapiTools.userId, userId), eq(openapiTools.enabled, true))),
  ]);

  const candidates: SelectedSkill[] = [];

  for (const s of skills) {
    const descKws = keywords(`${s.name} ${s.description ?? ""}`);
    const score = jaccardScore(questionKws, descKws);
    if (score >= threshold) {
      candidates.push({ id: s.id, name: s.name, description: s.description ?? "", type: "user_skill", relevanceScore: score });
    }
  }

  for (const t of tools) {
    const descKws = keywords(`${t.name} ${t.description}`);
    const score = jaccardScore(questionKws, descKws);
    if (score >= threshold) {
      candidates.push({ id: t.id, name: t.name, description: t.description, type: "openapi_tool", relevanceScore: score });
    }
  }

  return candidates
    .sort((a, b) => b.relevanceScore - a.relevanceScore)
    .slice(0, topN);
}

/**
 * Build a context block for the council describing available tools.
 * Injected into the system prompt if skills were selected.
 */
export function buildSkillContextBlock(skills: SelectedSkill[]): string {
  if (skills.length === 0) return "";
  const lines = skills.map(s =>
    `- **${s.name}** (${s.type}): ${s.description}`
  );
  return `\n\n---\nAvailable tools for this query:\n${lines.join("\n")}\nUse these tools if they can help answer the question.\n---\n`;
}
