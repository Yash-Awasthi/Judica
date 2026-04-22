import { routeAndCollect } from "../router/index.js";
import logger from "../lib/logger.js";

/** Sanitize language identifier for safe interpolation into markdown code fences */
function sanitizeLanguage(lang: string): string {
  return lang.replace(/[^a-zA-Z0-9_+-]/g, "").substring(0, 30);
}

/**
 * Refactoring Assistant: analyses code for improvement opportunities,
 * generates before/after diffs, and performs safety analysis.
 */

export interface RefactoringOpportunity {
  type: RefactoringType;
  description: string;
  severity: "suggestion" | "warning" | "critical";
  location: { startLine: number; endLine: number };
  effort: "trivial" | "small" | "medium" | "large";
}

export type RefactoringType =
  | "extract_function"
  | "rename"
  | "simplify_conditional"
  | "remove_duplication"
  | "extract_constant"
  | "improve_typing"
  | "reduce_complexity"
  | "dead_code"
  | "performance"
  | "other";

export interface RefactoringDiff {
  original: string;
  refactored: string;
  explanation: string;
  opportunity: RefactoringOpportunity;
}

export interface SafetyAnalysis {
  safe: boolean;
  risks: SafetyRisk[];
  behaviorPreserved: boolean;
  typeCompatible: boolean;
  publicAPIChanged: boolean;
}

export interface SafetyRisk {
  level: "info" | "warning" | "error";
  description: string;
  mitigation?: string;
}

export interface RefactoringResult {
  opportunities: RefactoringOpportunity[];
  diffs: RefactoringDiff[];
  safety: SafetyAnalysis;
  summary: string;
}

// ─── Opportunity Detection ──────────────────────────────────────────────────

/**
 * Detect refactoring opportunities in the given code.
 */
export async function detectOpportunities(
  code: string,
  language: string = "typescript",
): Promise<RefactoringOpportunity[]> {
  try {
    const result = await routeAndCollect({
      model: "auto",
      messages: [
        {
          role: "user",
          content: `Analyze this ${language} code for refactoring opportunities. Look for:
- Functions that are too long or do too many things (extract_function)
- Poor variable/function names (rename)
- Complex conditionals that could be simplified (simplify_conditional)
- Duplicated code blocks (remove_duplication)
- Magic numbers or repeated literals (extract_constant)
- Missing or weak type annotations (improve_typing)
- High cyclomatic complexity (reduce_complexity)
- Unreachable or unused code (dead_code)
- Performance anti-patterns (performance)

Return a JSON array:
[{
  "type": "extract_function|rename|simplify_conditional|remove_duplication|extract_constant|improve_typing|reduce_complexity|dead_code|performance|other",
  "description": "what to refactor and why",
  "severity": "suggestion|warning|critical",
  "location": { "startLine": 1, "endLine": 5 },
  "effort": "trivial|small|medium|large"
}]

Code:
\`\`\`${sanitizeLanguage(language)}
${code.substring(0, 4000)}
\`\`\`

Return ONLY the JSON array.`,
        },
      ],
      temperature: 0,
    });

    const match = result.text.match(/\[[\s\S]*\]/);
    if (match) {
      return JSON.parse(match[0]) as RefactoringOpportunity[];
    }
    return [];
  } catch (err) {
    logger.error({ err }, "Failed to detect refactoring opportunities");
    return [];
  }
}

// ─── Diff Generation ────────────────────────────────────────────────────────

/**
 * Generate a refactored version of the code for a specific opportunity.
 */
export async function generateDiff(
  code: string,
  opportunity: RefactoringOpportunity,
  language: string = "typescript",
): Promise<RefactoringDiff | null> {
  try {
    const result = await routeAndCollect({
      model: "auto",
      messages: [
        {
          role: "user",
          content: `Apply this refactoring to the code:

Refactoring: ${opportunity.type} — ${opportunity.description}
Location: lines ${opportunity.location.startLine}-${opportunity.location.endLine}

Original code:
\`\`\`${sanitizeLanguage(language)}
${code.substring(0, 4000)}
\`\`\`

Return a JSON object with the refactored version:
{
  "original": "the original code section being changed",
  "refactored": "the refactored replacement code",
  "explanation": "step-by-step explanation of what changed and why"
}

Return ONLY the JSON object.`,
        },
      ],
      temperature: 0,
    });

    const match = result.text.match(/\{[\s\S]*\}/);
    if (match) {
      const parsed = JSON.parse(match[0]) as Omit<RefactoringDiff, "opportunity">;
      return { ...parsed, opportunity };
    }
    return null;
  } catch (err) {
    logger.error({ err, type: opportunity.type }, "Failed to generate refactoring diff");
    return null;
  }
}

// ─── Safety Analysis ────────────────────────────────────────────────────────

/**
 * Analyse whether a refactoring is safe to apply.
 */
export async function analyzeSafety(
  originalCode: string,
  refactoredCode: string,
  language: string = "typescript",
): Promise<SafetyAnalysis> {
  try {
    const result = await routeAndCollect({
      model: "auto",
      messages: [
        {
          role: "user",
          content: `Analyze the safety of this code refactoring.

Original:
\`\`\`${sanitizeLanguage(language)}
${originalCode.substring(0, 3000)}
\`\`\`

Refactored:
\`\`\`${sanitizeLanguage(language)}
${refactoredCode.substring(0, 3000)}
\`\`\`

Check for:
1. Behavior preservation — does the refactored code produce identical outputs?
2. Type compatibility — are all type signatures preserved?
3. Public API changes — are any exported interfaces/signatures changed?
4. Side effect changes — are side effects preserved or removed?
5. Error handling — is error behavior maintained?

Return a JSON object:
{
  "safe": true/false,
  "risks": [{ "level": "info|warning|error", "description": "risk description", "mitigation": "how to mitigate" }],
  "behaviorPreserved": true/false,
  "typeCompatible": true/false,
  "publicAPIChanged": true/false
}

Return ONLY the JSON object.`,
        },
      ],
      temperature: 0,
    });

    const match = result.text.match(/\{[\s\S]*\}/);
    if (match) {
      return JSON.parse(match[0]) as SafetyAnalysis;
    }
    return defaultSafetyAnalysis();
  } catch (err) {
    logger.error({ err }, "Safety analysis failed");
    return defaultSafetyAnalysis();
  }
}

function defaultSafetyAnalysis(): SafetyAnalysis {
  return {
    safe: false,
    risks: [{ level: "warning", description: "Safety analysis could not be completed", mitigation: "Manual review required" }],
    behaviorPreserved: false,
    typeCompatible: false,
    publicAPIChanged: false,
  };
}

// ─── Full Refactoring Pipeline ──────────────────────────────────────────────

/**
 * Full refactoring pipeline: detect → generate diffs → safety analysis.
 */
export async function refactorCode(
  code: string,
  language: string = "typescript",
  options?: { maxOpportunities?: number; types?: RefactoringType[] },
): Promise<RefactoringResult> {
  logger.info({ language, codeLength: code.length }, "Starting refactoring analysis");

  // Step 1: Detect opportunities
  let opportunities = await detectOpportunities(code, language);

  // Filter by type if specified
  if (options?.types?.length) {
    opportunities = opportunities.filter((o) => options.types!.includes(o.type));
  }

  // Limit to top N by severity
  const severityOrder: Record<string, number> = { critical: 0, warning: 1, suggestion: 2 };
  opportunities.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);
  // P28-10: Hard cap maxOpportunities to prevent unbounded parallel LLM calls
  const maxOps = Math.min(options?.maxOpportunities ?? 5, 20);
  opportunities = opportunities.slice(0, maxOps);

  // Step 2: Generate diffs for each opportunity
  const diffPromises = opportunities.map((op) => generateDiff(code, op, language));
  const diffResults = await Promise.all(diffPromises);
  const diffs = diffResults.filter((d): d is RefactoringDiff => d !== null);

  // Step 3: Safety analysis on the combined refactoring
  let safety: SafetyAnalysis;
  if (diffs.length > 0) {
    // Apply all diffs to produce the final refactored code
    const combinedRefactored = diffs.map((d) => d.refactored).join("\n\n// ---\n\n");
    safety = await analyzeSafety(code, combinedRefactored, language);
  } else {
    safety = { safe: true, risks: [], behaviorPreserved: true, typeCompatible: true, publicAPIChanged: false };
  }

  // Step 4: Generate summary
  const summary = formatSummary(opportunities, diffs, safety);

  logger.info(
    { opportunityCount: opportunities.length, diffCount: diffs.length, safe: safety.safe },
    "Refactoring analysis complete",
  );

  return { opportunities, diffs, safety, summary };
}

/**
 * Format a human-readable summary of the refactoring analysis.
 */
export function formatSummary(
  opportunities: RefactoringOpportunity[],
  diffs: RefactoringDiff[],
  safety: SafetyAnalysis,
): string {
  const lines: string[] = [];

  lines.push(`## Refactoring Analysis`);
  lines.push(``);
  lines.push(`Found **${opportunities.length}** refactoring opportunit${opportunities.length === 1 ? "y" : "ies"}:`);
  lines.push(``);

  for (const op of opportunities) {
    const icon = op.severity === "critical" ? "🔴" : op.severity === "warning" ? "🟡" : "🔵";
    lines.push(`- ${icon} **${op.type}** (${op.severity}, ${op.effort} effort): ${op.description}`);
  }

  if (diffs.length > 0) {
    lines.push(``);
    lines.push(`### Generated ${diffs.length} diff${diffs.length === 1 ? "" : "s"}`);
    lines.push(``);

    for (const diff of diffs) {
      lines.push(`**${diff.opportunity.type}**: ${diff.explanation}`);
    }
  }

  lines.push(``);
  lines.push(`### Safety: ${safety.safe ? "✅ Safe to apply" : "⚠️ Review required"}`);

  if (safety.risks.length > 0) {
    for (const risk of safety.risks) {
      const icon = risk.level === "error" ? "❌" : risk.level === "warning" ? "⚠️" : "ℹ️";
      lines.push(`- ${icon} ${risk.description}`);
    }
  }

  return lines.join("\n");
}
