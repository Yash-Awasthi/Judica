/**
 * Specialisation Mode — Phase 1.6
 *
 * Domain-specific council adaptation: code, legal, medical, creative, research.
 * Modeled after:
 * - CrewAI (MIT, crewAIInc/crewAI) — role-based agent specialisation with
 *   domain-specific tool assignment and system prompt injection
 * - AutoGen (MIT, Microsoft/autogen) — domain-adaptive multi-agent conversations
 *   where agent selection and prompting adapts to the domain context
 *
 * Approach:
 * 1. Inject a domain preamble into each agent's system prompt
 * 2. Bias agent selection: some archetypes are better fits per domain
 * 3. Select domain-relevant tools (passed to council members)
 */

import type { Provider } from "./providers.js";

export type SpecialisationDomain = "auto" | "code" | "legal" | "medical" | "creative" | "research";

// ─── Domain preambles ────────────────────────────────────────────────────────
// Injected at the start of each council member's system prompt.
// CrewAI-style: opinionated, specific, not generic.
const DOMAIN_PREAMBLES: Record<Exclude<SpecialisationDomain, "auto">, string> = {
  code: `You are operating in CODE specialisation mode.
Prioritise: correctness, performance, security, readability, and testability.
Always show concrete code examples. Reference specific language versions and libraries.
Flag security vulnerabilities (OWASP Top 10). Prefer idiomatic patterns over clever tricks.
When reviewing code, check: error handling, edge cases, memory/resource leaks, and test coverage.`,

  legal: `You are operating in LEGAL specialisation mode.
Prioritise: precision of language, jurisdiction awareness, and risk identification.
Always note that this is not legal advice and recommend consulting qualified legal counsel.
Cite specific statutes, regulations, or case law where relevant (note if uncertain).
Flag ambiguous clauses, potential liability, and missing protections.
Distinguish between contract law, tort, regulatory, and criminal contexts explicitly.`,

  medical: `You are operating in MEDICAL specialisation mode.
Prioritise: evidence-based reasoning, clinical accuracy, and patient safety.
Always note that this is not medical advice and recommend consulting qualified healthcare professionals.
Cite clinical studies, guidelines (NICE, CDC, WHO), and drug databases where relevant.
Flag contraindications, drug interactions, and safety considerations prominently.
Distinguish between diagnosis, treatment, prevention, and pharmacology contexts explicitly.`,

  creative: `You are operating in CREATIVE specialisation mode.
Prioritise: originality, emotional resonance, narrative structure, and stylistic coherence.
Embrace ambiguity and metaphor. Suggest unexpected angles and subversions of conventions.
Critique with specificity: what works, what doesn't, and concrete alternatives.
Reference relevant artistic movements, authors, or works to contextualise feedback.
Prioritise voice and authenticity over formulaic correctness.`,

  research: `You are operating in RESEARCH specialisation mode.
Prioritise: epistemic rigour, source quality, and falsifiability.
Always distinguish between primary sources, meta-analyses, expert consensus, and speculation.
Flag sample sizes, methodological limitations, and replication status.
Propose alternative hypotheses and identify confounding variables.
Structure responses as: finding → evidence quality → caveats → open questions.`,
};

// ─── Domain-archetype affinity ────────────────────────────────────────────────
// CrewAI assigns roles to agents. We weight which archetypes are most relevant
// per domain. Archetypes with higher weight are preferred in auto-council selection.
export const DOMAIN_ARCHETYPE_AFFINITY: Record<Exclude<SpecialisationDomain, "auto">, Record<string, number>> = {
  code: {
    architect: 1.5,
    empiricist: 1.3,
    pragmatist: 1.4,
    contrarian: 1.2,
    judge: 1.1,
    minimalist: 1.3,
  },
  legal: {
    judge: 1.5,
    empiricist: 1.4,
    ethicist: 1.3,
    historian: 1.2,
    contrarian: 1.2,
  },
  medical: {
    empiricist: 1.5,
    judge: 1.3,
    ethicist: 1.4,
    contrarian: 1.2,
  },
  creative: {
    creator: 1.5,
    futurist: 1.3,
    empath: 1.3,
    outsider: 1.4,
    contrarian: 1.2,
  },
  research: {
    empiricist: 1.5,
    historian: 1.3,
    contrarian: 1.4,
    architect: 1.2,
    judge: 1.2,
  },
};

// ─── Domain tool preferences ─────────────────────────────────────────────────
// Tools to prioritise loading per domain (from the existing tool registry).
export const DOMAIN_PREFERRED_TOOLS: Record<Exclude<SpecialisationDomain, "auto">, string[]> = {
  code: ["code_executor", "github_search", "read_file", "calculator"],
  legal: ["web_search", "read_webpage", "wikipedia"],
  medical: ["web_search", "read_webpage", "wikipedia"],
  creative: ["web_search", "read_webpage"],
  research: ["web_search", "read_webpage", "wikipedia", "arxiv_search"],
};

// ─── Apply specialisation ─────────────────────────────────────────────────────

/**
 * Inject domain preamble into a provider's system prompt.
 * Mirrors CrewAI's agent.role + agent.goal injection pattern.
 */
export function applyDomainToProvider(
  provider: Provider,
  domain: Exclude<SpecialisationDomain, "auto">,
): Provider {
  const preamble = DOMAIN_PREAMBLES[domain];
  const existing = provider.systemPrompt || "";
  return {
    ...provider,
    systemPrompt: existing ? `${preamble}\n\n${existing}` : preamble,
  };
}

/**
 * Apply specialisation to all council members.
 */
export function applySpecialisationMode(
  members: Provider[],
  domain: SpecialisationDomain,
): Provider[] {
  if (domain === "auto") return members;
  return members.map(m => applyDomainToProvider(m, domain));
}

/**
 * Auto-detect domain from question text using keyword scoring.
 * Mirrors AutoGen's domain-classification approach.
 */
const DOMAIN_KEYWORDS: Record<Exclude<SpecialisationDomain, "auto">, string[]> = {
  code: ["function", "class", "bug", "error", "compile", "runtime", "algorithm", "API", "database", "SQL", "async", "thread", "git", "deploy", "typescript", "python", "javascript", "rust", "golang"],
  legal: ["contract", "law", "legal", "statute", "regulation", "liability", "clause", "agreement", "court", "plaintiff", "defendant", "jurisdiction", "intellectual property", "copyright", "trademark"],
  medical: ["diagnosis", "symptom", "treatment", "medication", "disease", "clinical", "patient", "surgery", "drug", "dose", "therapeutic", "prognosis", "pathology", "physician"],
  creative: ["story", "novel", "poem", "character", "narrative", "plot", "writing", "creative", "artistic", "design", "screenplay", "dialogue", "worldbuilding", "metaphor"],
  research: ["study", "paper", "hypothesis", "evidence", "data", "methodology", "experiment", "survey", "literature review", "findings", "sample", "correlation", "statistical"],
};

export function autoDetectDomain(question: string): SpecialisationDomain {
  const lower = question.toLowerCase();
  const scores: Record<Exclude<SpecialisationDomain, "auto">, number> = {
    code: 0, legal: 0, medical: 0, creative: 0, research: 0,
  };

  for (const [domain, keywords] of Object.entries(DOMAIN_KEYWORDS) as Array<[Exclude<SpecialisationDomain, "auto">, string[]]>) {
    for (const kw of keywords) {
      if (lower.includes(kw.toLowerCase())) scores[domain]++;
    }
  }

  const best = (Object.entries(scores) as Array<[Exclude<SpecialisationDomain, "auto">, number]>)
    .sort((a, b) => b[1] - a[1])[0];

  // Only auto-detect if signal is strong enough (≥3 matching keywords)
  return best[1] >= 3 ? best[0] : "auto";
}
