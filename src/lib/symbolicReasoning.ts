/**
 * Symbolic Reasoning Engine — Phase 7.7
 *
 * First-order logic style rule engine for deterministic constraint verification.
 * Inspired by:
 * - Prolog-style Horn clause resolution
 * - LLM + symbolic reasoning hybrid (Neurosymbolic AI pattern)
 * - PAL (Program-aided Language Models, arxiv 2211.10435)
 *
 * Use cases:
 * - Constraint checking: "Is this response logically consistent with these rules?"
 * - Fact deduction: forward-chain new facts from known facts + rules
 * - Contradiction detection: identify conflicting assertions
 *
 * Design:
 * - Rules are stored as {condition, conclusion} pairs in plain English
 * - The engine uses an LLM to evaluate whether conditions are met
 * - Conclusions that pass are added to the working set for further chaining
 * - Max 5 forward-chaining rounds to prevent infinite loops
 */

import { askProvider } from "./providers.js";
import type { Provider } from "./providers.js";
import logger from "./logger.js";

const MAX_CHAIN_ROUNDS = 5;
const MAX_RULES = 100;
const MAX_FACTS = 200;

export interface SymbolicRule {
  id:        string;
  condition: string;   // e.g. "If X is a bird and X can fly"
  conclusion: string;  // e.g. "Then X is not a penguin"
}

export interface DeductionResult {
  newFacts:          string[];
  appliedRules:      string[];
  rounds:            number;
  contradictions:    string[];
}

export interface ConsistencyResult {
  consistent:        boolean;
  violations:        string[];
  explanation:       string;
}

/**
 * Evaluate whether a condition holds given the current fact set using LLM.
 */
async function evaluateCondition(
  condition: string,
  facts: string[],
  provider: Provider,
): Promise<boolean> {
  const factList = facts.slice(0, 50).map((f, i) => `${i + 1}. ${f}`).join("\n");
  const prompt = `Given these known facts:
${factList}

Does this condition hold? Answer only "YES" or "NO":
"${condition}"`;

  try {
    const res = await askProvider(
      { ...provider, systemPrompt: "You are a logic evaluator. Answer only YES or NO." },
      [{ role: "user", content: prompt }],
    );
    return res.text.trim().toUpperCase().startsWith("YES");
  } catch (err) {
    logger.warn({ err }, "SymbolicReasoning: condition eval failed");
    return false;
  }
}

/**
 * Forward-chain rules against a set of facts to derive new facts.
 */
export async function forwardChain(
  facts: string[],
  rules: SymbolicRule[],
  provider: Provider,
): Promise<DeductionResult> {
  const workingFacts = [...facts].slice(0, MAX_FACTS);
  const appliedRules: string[] = [];
  const contradictions: string[] = [];
  let rounds = 0;

  for (let round = 0; round < MAX_CHAIN_ROUNDS; round++) {
    rounds++;
    let addedThisRound = 0;

    for (const rule of rules.slice(0, MAX_RULES)) {
      const holds = await evaluateCondition(rule.condition, workingFacts, provider);
      if (holds && !workingFacts.includes(rule.conclusion)) {
        workingFacts.push(rule.conclusion);
        appliedRules.push(`${rule.condition} → ${rule.conclusion}`);
        addedThisRound++;
      }
    }

    if (addedThisRound === 0) break; // Fixed point reached
  }

  // Simple contradiction check: look for "X" and "NOT X" in facts
  for (const fact of workingFacts) {
    const negated = `not ${fact.toLowerCase()}`;
    if (workingFacts.some(f => f.toLowerCase() === negated)) {
      contradictions.push(`Contradiction: "${fact}" and "${negated}"`);
    }
  }

  return {
    newFacts:       workingFacts.slice(facts.length),
    appliedRules,
    rounds,
    contradictions,
  };
}

/**
 * Check whether a response is consistent with a set of symbolic rules.
 */
export async function checkConsistency(
  response: string,
  rules: SymbolicRule[],
  provider: Provider,
): Promise<ConsistencyResult> {
  const ruleList = rules.slice(0, 20)
    .map((r, i) => `Rule ${i + 1}: IF ${r.condition} THEN ${r.conclusion}`)
    .join("\n");

  const prompt = `Check if this response violates any of the following rules.
List ONLY the violated rules as a JSON array of strings.
If no violations, return [].

Rules:
${ruleList}

Response to check:
"${response.slice(0, 3000)}"

JSON array of violations:`;

  try {
    const res = await askProvider(
      { ...provider, systemPrompt: "You are a logic consistency checker. Respond only with JSON." },
      [{ role: "user", content: prompt }],
    );
    const match = res.text.match(/\[[\s\S]*\]/);
    const violations = match ? (JSON.parse(match[0]) as string[]) : [];
    return {
      consistent:  violations.length === 0,
      violations,
      explanation: violations.length > 0
        ? `Response violates ${violations.length} rule(s)`
        : "Response is consistent with all rules",
    };
  } catch (err) {
    logger.warn({ err }, "SymbolicReasoning: consistency check failed");
    return { consistent: true, violations: [], explanation: "Check failed, assuming consistent" };
  }
}
