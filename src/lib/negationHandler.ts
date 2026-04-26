/**
 * Perfect Negation Handling — Phase 7.4
 *
 * Detects explicit negations and corrections across turns
 * and builds a persistent negation registry per conversation.
 *
 * Inspired by:
 * - OpenAI system prompt negation patterns (instruction following research)
 * - Anthropic Constitutional AI — explicit "do not" rule injection
 *
 * How it works:
 * 1. Detect negation triggers in the user message ("don't", "never", "stop doing X")
 * 2. Extract the negated behavior as a compact rule
 * 3. Store rules in the negation registry (Redis-backed, falls back to in-memory)
 * 4. On each subsequent turn, prepend active negation rules to the system prompt
 */

import redis from "./redis.js";
import logger from "./logger.js";
import { askProvider } from "./providers.js";
import type { Provider } from "./providers.js";

const NEGATION_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days
const MAX_RULES_PER_CONV = 50;

// Heuristic trigger phrases
const NEGATION_TRIGGERS: RegExp[] = [
  /\bdon'?t\b.{0,80}/gi,
  /\bnever\b.{0,80}/gi,
  /\bstop\s+(doing|saying|being|using)\b.{0,80}/gi,
  /\bno\s+more\b.{0,80}/gi,
  /\bavoid\b.{0,80}/gi,
  /\bdo\s+not\b.{0,80}/gi,
  /\bnot\s+like\s+(last|before|previously)\b.{0,80}/gi,
  /\bwithout\s+(mentioning|including|adding)\b.{0,80}/gi,
];

export interface NegationRule {
  id:        string;
  rule:      string;
  addedAt:   number;
  source:    "heuristic" | "llm";
}

function redisKey(conversationId: string) {
  return `negation:${conversationId}`;
}

// In-memory fallback when Redis is unavailable
const inMemoryStore = new Map<string, NegationRule[]>();

async function loadRules(conversationId: string): Promise<NegationRule[]> {
  try {
    const raw = await redis.get(redisKey(conversationId));
    if (!raw) return [];
    return JSON.parse(raw) as NegationRule[];
  } catch {
    return inMemoryStore.get(conversationId) ?? [];
  }
}

async function saveRules(conversationId: string, rules: NegationRule[]): Promise<void> {
  try {
    await redis.set(redisKey(conversationId), JSON.stringify(rules), "EX", NEGATION_TTL_SECONDS);
  } catch {
    inMemoryStore.set(conversationId, rules);
  }
}

/**
 * Detect negation triggers in a message using heuristics only (fast path).
 */
export function detectNegationTriggers(message: string): string[] {
  const matches: string[] = [];
  for (const pattern of NEGATION_TRIGGERS) {
    const found = message.match(pattern);
    if (found) matches.push(...found.map(m => m.trim().slice(0, 200)));
  }
  return matches;
}

/**
 * Extract clean negation rules from a message using an LLM.
 * Returns compact rules like "Do not use bullet points".
 */
export async function extractNegationRules(
  message: string,
  provider: Provider,
): Promise<string[]> {
  const prompt = `Extract explicit negation or correction instructions from this user message.
Return ONLY a JSON array of short, imperative rules (e.g. "Do not use bullet points").
If there are no negation instructions, return an empty array [].
Keep each rule under 100 characters. Max 5 rules.

User message:
"${message.slice(0, 2000)}"

JSON array:`;

  try {
    const response = await askProvider(
      { ...provider, systemPrompt: "You extract negation rules from user messages. Respond only with JSON." },
      [{ role: "user", content: prompt }],
    );
    const match = response.text.match(/\[[\s\S]*\]/);
    if (!match) return [];
    const rules = JSON.parse(match[0]) as unknown[];
    return rules
      .filter(r => typeof r === "string")
      .slice(0, 5) as string[];
  } catch (err) {
    logger.warn({ err }, "NegationHandler: LLM extraction failed, using heuristics");
    return detectNegationTriggers(message).slice(0, 5);
  }
}

/**
 * Add new negation rules to the registry for a conversation.
 */
export async function addNegationRules(
  conversationId: string,
  rules: string[],
  source: "heuristic" | "llm" = "llm",
): Promise<NegationRule[]> {
  const existing = await loadRules(conversationId);

  const newRules: NegationRule[] = rules.map(rule => ({
    id:      `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    rule,
    addedAt: Date.now(),
    source,
  }));

  const merged = [...existing, ...newRules].slice(-MAX_RULES_PER_CONV);
  await saveRules(conversationId, merged);
  return merged;
}

/**
 * Get all active negation rules for a conversation.
 */
export async function getNegationRules(conversationId: string): Promise<NegationRule[]> {
  return loadRules(conversationId);
}

/**
 * Delete a specific negation rule by ID.
 */
export async function deleteNegationRule(conversationId: string, ruleId: string): Promise<void> {
  const rules = await loadRules(conversationId);
  await saveRules(conversationId, rules.filter(r => r.id !== ruleId));
}

/**
 * Clear all negation rules for a conversation.
 */
export async function clearNegationRules(conversationId: string): Promise<void> {
  try {
    await redis.del(redisKey(conversationId));
  } catch {
    inMemoryStore.delete(conversationId);
  }
}

/**
 * Build the negation injection block to prepend to the system prompt.
 */
export function buildNegationBlock(rules: NegationRule[]): string {
  if (rules.length === 0) return "";
  const list = rules.map(r => `- ${r.rule}`).join("\n");
  return `[NEGATION RULES — MUST FOLLOW]\n${list}\n\n`;
}
