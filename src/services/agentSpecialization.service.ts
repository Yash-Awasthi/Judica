import { db } from "../lib/drizzle.js";
import { modelReliability } from "../db/schema/traces.js";
import { sql } from "drizzle-orm";
import { ARCHETYPES } from "../config/archetypes.js";
import logger from "../lib/logger.js";

// ─── Domain Profiles ─────────────────────────────────────────────────────────

export interface DomainProfile {
  id: string;
  name: string;
  domains: string[];
  archetypeWeights: Record<string, number>;
  systemPromptSuffix: string;
  preferredSummons: string;
}

/**
 * Pre-configured domain profiles that adjust council composition
 * and reasoning style for specific domains.
 */
export const DOMAIN_PROFILES: Record<string, DomainProfile> = {
  legal: {
    id: "legal",
    name: "Legal Analysis",
    domains: ["law", "legal", "compliance", "regulation", "contract", "liability"],
    archetypeWeights: {
      historian: 1.5,
      ethicist: 1.3,
      contrarian: 1.2,
      pragmatist: 1.0,
      empiricist: 0.8,
    },
    systemPromptSuffix: "Apply legal reasoning principles: precedent, statutory interpretation, risk assessment. Cite relevant legal frameworks where applicable.",
    preferredSummons: "research",
  },
  medical: {
    id: "medical",
    name: "Medical/Health",
    domains: ["medical", "health", "clinical", "diagnosis", "treatment", "patient"],
    archetypeWeights: {
      empiricist: 1.5,
      ethicist: 1.3,
      historian: 1.2,
      pragmatist: 1.1,
      contrarian: 0.9,
    },
    systemPromptSuffix: "Apply evidence-based medical reasoning. Distinguish between established evidence and emerging research. Always flag potential safety concerns.",
    preferredSummons: "research",
  },
  financial: {
    id: "financial",
    name: "Financial Analysis",
    domains: ["finance", "investment", "trading", "portfolio", "risk", "market", "valuation"],
    archetypeWeights: {
      empiricist: 1.5,
      strategist: 1.4,
      pragmatist: 1.2,
      contrarian: 1.1,
      futurist: 1.0,
    },
    systemPromptSuffix: "Apply quantitative financial analysis. Consider risk-return tradeoffs, market conditions, and regulatory constraints. Use specific metrics and benchmarks.",
    preferredSummons: "business",
  },
  engineering: {
    id: "engineering",
    name: "Software Engineering",
    domains: ["code", "software", "engineering", "architecture", "database", "api", "system"],
    archetypeWeights: {
      architect: 1.5,
      pragmatist: 1.3,
      empiricist: 1.2,
      minimalist: 1.1,
      contrarian: 1.0,
    },
    systemPromptSuffix: "Apply software engineering best practices. Consider scalability, maintainability, and performance. Reference design patterns and industry standards.",
    preferredSummons: "technical",
  },
};

// P59-02: Freeze domain profiles to prevent runtime mutation
Object.freeze(DOMAIN_PROFILES);
for (const p of Object.values(DOMAIN_PROFILES)) Object.freeze(p);

/**
 * Detect the domain of a query from keyword matching.
 */
export function detectDomain(query: string): DomainProfile | null {
  const lowerQuery = query.toLowerCase();

  let bestMatch: DomainProfile | null = null;
  let bestScore = 0;

  for (const profile of Object.values(DOMAIN_PROFILES)) {
    const matchCount = profile.domains.filter((d) => lowerQuery.includes(d)).length;
    if (matchCount > bestScore) {
      bestScore = matchCount;
      bestMatch = profile;
    }
  }

  return bestScore > 0 ? bestMatch : null;
}

/**
 * Get recommended archetypes for a domain, weighted by domain profile.
 * Returns archetype IDs sorted by domain relevance.
 */
export function getDomainArchetypes(domain: DomainProfile): string[] {
  return Object.entries(domain.archetypeWeights)
    .sort((a, b) => b[1] - a[1])
    .map(([id]) => id)
    .filter((id) => id in ARCHETYPES);
}

// ─── Self-Improving Personas ─────────────────────────────────────────────────

export interface PersonaPerformance {
  personaId: string;
  totalDeliberations: number;
  agreementRate: number;
  avgScore: number;
  recentTrend: "improving" | "stable" | "declining";
}

/**
 * Track persona performance based on agreement with consensus.
 * Uses model reliability data to compute per-persona metrics.
 */
export async function getPersonaPerformance(
  models: string[],
): Promise<PersonaPerformance[]> {
  if (models.length === 0) return [];

  try {
    const rows = await db
      .select()
      .from(modelReliability)
      .where(sql`"model" = ANY(${models}::text[])`);

    return rows.map((row) => {
      const total = row.totalResponses || 1;
      const agreed = row.agreedWith || 0;
      const contradicted = row.contradicted || 0;
      // P59-09: Use natural rate with explicit zero-case, avoiding Laplace smoothing bias
      const agreementRate = (agreed + contradicted) > 0 ? agreed / (agreed + contradicted) : 0.5;

      // Determine trend based on avg confidence vs agreement rate
      const confidenceGap = (row.avgConfidence || 0.5) - agreementRate;
      let trend: "improving" | "stable" | "declining" = "stable";
      if (confidenceGap > 0.1) trend = "declining"; // overconfident
      if (confidenceGap < -0.1) trend = "improving"; // underconfident → improving

      return {
        personaId: row.model,
        totalDeliberations: total,
        agreementRate: Math.round(agreementRate * 100) / 100,
        avgScore: row.avgConfidence || 0.5,
        recentTrend: trend,
      };
    });
  } catch (err) {
    logger.warn({ err }, "Failed to get persona performance");
    return [];
  }
}

/**
 * Generate prompt adjustments for a persona based on its performance.
 * Self-improving: adjusts guidance when persona diverges from consensus.
 */
export function generatePromptAdjustment(performance: PersonaPerformance): string | null {
  if (performance.totalDeliberations < 5) return null; // Not enough data

  if (performance.agreementRate < 0.3) {
    return "NOTE: Your recent responses have frequently diverged from the council consensus. Focus on providing well-supported claims with clear evidence. Avoid speculative or contrarian positions unless specifically requested.";
  }

  if (performance.agreementRate > 0.9) {
    return "NOTE: Your responses have been highly aligned with consensus. Consider whether you're adding unique value. Don't hesitate to present well-reasoned alternative perspectives when your analysis supports them.";
  }

  if (performance.recentTrend === "declining") {
    return "NOTE: Your confidence has been higher than your accuracy rate. Calibrate your confidence levels more carefully — express uncertainty when evidence is mixed.";
  }

  return null;
}

// ─── Confidence Calibration ──────────────────────────────────────────────────

export interface CalibrationResult {
  model: string;
  statedConfidence: number;
  actualAccuracy: number;
  calibrationError: number;
  recommendation: string;
}

/**
 * Compute calibration error for models: difference between
 * stated confidence and actual agreement rate.
 * Well-calibrated models have error near 0.
 */
export async function computeCalibration(
  models: string[],
): Promise<CalibrationResult[]> {
  const performances = await getPersonaPerformance(models);

  return performances.map((p) => {
    const calibrationError = Math.abs(p.avgScore - p.agreementRate);

    let recommendation: string;
    if (calibrationError < 0.1) {
      recommendation = "Well calibrated";
    } else if (p.avgScore > p.agreementRate) {
      recommendation = `Overconfident by ${(calibrationError * 100).toFixed(0)}% — reduce confidence scores`;
    } else {
      recommendation = `Underconfident by ${(calibrationError * 100).toFixed(0)}% — increase confidence scores`;
    }

    return {
      model: p.personaId,
      statedConfidence: p.avgScore,
      actualAccuracy: p.agreementRate,
      calibrationError: Math.round(calibrationError * 1000) / 1000,
      recommendation,
    };
  });
}

// ─── Dynamic Delegation ──────────────────────────────────────────────────────

export interface DelegationSuggestion {
  subtask: string;
  suggestedArchetype: string;
  reason: string;
}

// P59-03: Module-level constant — avoids recreating 10 regex patterns per call
const DELEGATION_RULES: { pattern: RegExp; archetype: string; reason: string }[] = [
  { pattern: /\b(code|implement|build|debug|refactor)\b/, archetype: "architect", reason: "Implementation task — systems thinking" },
  { pattern: /\b(research|investigate|find|search|look up)\b/, archetype: "empiricist", reason: "Research task — data-driven analysis" },
  { pattern: /\b(risk|danger|concern|safety|security)\b/, archetype: "contrarian", reason: "Risk assessment — adversarial thinking" },
  { pattern: /\b(ethic|moral|fair|bias|privacy|consent)\b/, archetype: "ethicist", reason: "Ethical consideration — values-driven" },
  { pattern: /\b(trend|future|predict|forecast|emerging)\b/, archetype: "futurist", reason: "Trend analysis — long-term thinking" },
  { pattern: /\b(plan|strategy|compete|position|market)\b/, archetype: "strategist", reason: "Strategic planning — game theory" },
  { pattern: /\b(simplif|reduc|minimiz|essenti|core)\b/, archetype: "minimalist", reason: "Simplification task — Occam's razor" },
  { pattern: /\b(history|precedent|pattern|past|previous)\b/, archetype: "historian", reason: "Historical analysis — pattern matching" },
  { pattern: /\b(user|experience|feel|empathy|impact on people)\b/, archetype: "empath", reason: "User impact analysis — human-centered" },
  { pattern: /\b(creative|novel|innovat|brainstorm|idea)\b/, archetype: "creator", reason: "Creative task — novel synthesis" },
];

/**
 * Suggest which archetype should handle a subtask based on domain matching.
 * Used for dynamic delegation during deliberation.
 */
export function suggestDelegation(
  subtask: string,
  availableArchetypes: string[],
): DelegationSuggestion | null {
  const lower = subtask.toLowerCase();

  for (const rule of DELEGATION_RULES) {
    if (rule.pattern.test(lower) && availableArchetypes.includes(rule.archetype)) {
      return {
        subtask,
        suggestedArchetype: rule.archetype,
        reason: rule.reason,
      };
    }
  }

  return null;
}
