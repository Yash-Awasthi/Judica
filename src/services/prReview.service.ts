import { routeAndCollect } from "../router/index.js";
import logger from "../lib/logger.js";

/**
 * PR Review Agent: multi-perspective code review with
 * Security, Performance, and Style analysis.
 */

export type ReviewCategory = "security" | "performance" | "style";

export interface ReviewFinding {
  category: ReviewCategory;
  severity: "critical" | "warning" | "info";
  file: string;
  line?: number;
  description: string;
  suggestion?: string;
}

export interface ReviewSummary {
  approved: boolean;
  findings: ReviewFinding[];
  score: { security: number; performance: number; style: number; overall: number };
  summary: string;
}

const REVIEW_PERSPECTIVES: { category: ReviewCategory; prompt: string }[] = [
  {
    category: "security",
    prompt: `Review this code diff for SECURITY issues:
- Injection vulnerabilities (SQL, XSS, command injection)
- Authentication/authorization flaws
- Sensitive data exposure (secrets, PII in logs)
- Insecure deserialization or eval usage
- Missing input validation at trust boundaries
- Prototype pollution, path traversal
- Hardcoded credentials or API keys`,
  },
  {
    category: "performance",
    prompt: `Review this code diff for PERFORMANCE issues:
- N+1 queries or missing batch operations
- Unbounded data fetching (missing LIMIT, pagination)
- Memory leaks (unclosed handles, growing caches)
- Blocking I/O on hot paths
- Unnecessary re-computation (missing memoization)
- Large synchronous operations
- Missing indexes for frequent queries`,
  },
  {
    category: "style",
    prompt: `Review this code diff for STYLE and maintainability issues:
- Naming clarity (variables, functions, types)
- Function length and single-responsibility
- Error handling consistency
- Type safety (any usage, missing types)
- Dead code or unreachable branches
- Code duplication
- Missing or misleading comments`,
  },
];

/**
 * Review a code diff from a single perspective.
 */
async function reviewFromPerspective(
  diff: string,
  perspective: typeof REVIEW_PERSPECTIVES[number],
): Promise<ReviewFinding[]> {
  try {
    const result = await routeAndCollect({
      model: "auto",
      messages: [
        {
          role: "user",
          content: `${perspective.prompt}

Return a JSON array of findings:
[{
  "category": "${perspective.category}",
  "severity": "critical|warning|info",
  "file": "filename or path",
  "line": null,
  "description": "what the issue is",
  "suggestion": "how to fix it"
}]

If no issues found, return [].

Diff:
\`\`\`
${diff.substring(0, 5000)}
\`\`\`

Return ONLY the JSON array.`,
        },
      ],
      temperature: 0,
    });

    const match = result.text.match(/\[[\s\S]*\]/);
    if (match) {
      // P35-07: Safe JSON.parse with try-catch + array cap on LLM output
      try {
        const findings = JSON.parse(match[0]) as ReviewFinding[];
        return Array.isArray(findings) ? findings.slice(0, 100) : [];
      } catch {
        return [];
      }
    }
    return [];
  } catch (err) {
    logger.warn({ err, category: perspective.category }, "Review perspective failed");
    return [];
  }
}

/**
 * Calculate category and overall scores (0-100).
 */
function calculateScores(findings: ReviewFinding[]): ReviewSummary["score"] {
  const penalty: Record<string, number> = { critical: 25, warning: 10, info: 3 };
  const categoryFindings: Record<ReviewCategory, ReviewFinding[]> = {
    security: [],
    performance: [],
    style: [],
  };

  for (const f of findings) {
    categoryFindings[f.category].push(f);
  }

  const scoreFor = (category: ReviewCategory): number => {
    const total = categoryFindings[category].reduce(
      (sum, f) => sum + (penalty[f.severity] || 0),
      0,
    );
    return Math.max(0, 100 - total);
  };

  const security = scoreFor("security");
  const performance = scoreFor("performance");
  const style = scoreFor("style");

  // Security weighted more heavily
  const overall = Math.round(security * 0.5 + performance * 0.3 + style * 0.2);

  return { security, performance, style, overall };
}

/**
 * Run triple code review: Security + Performance + Style.
 */
export async function reviewDiff(diff: string): Promise<ReviewSummary> {
  logger.info({ diffLength: diff.length }, "Starting PR review");

  // Run all three perspectives in parallel
  const results = await Promise.all(
    REVIEW_PERSPECTIVES.map((p) => reviewFromPerspective(diff, p)),
  );

  const findings = results.flat();
  const score = calculateScores(findings);

  // Auto-approve if no critical findings and overall score >= 70
  const hasCritical = findings.some((f) => f.severity === "critical");
  const approved = !hasCritical && score.overall >= 70;

  const summary = formatReviewSummary(findings, score, approved);

  logger.info(
    { findingCount: findings.length, approved, score: score.overall },
    "PR review complete",
  );

  return { approved, findings, score, summary };
}

/**
 * Format the review as a readable comment.
 */
export function formatReviewSummary(
  findings: ReviewFinding[],
  score: ReviewSummary["score"],
  approved: boolean,
): string {
  const lines: string[] = [];

  lines.push(`## PR Review ${approved ? "✅ Approved" : "❌ Changes Requested"}`);
  lines.push(``);
  lines.push(`| Category | Score |`);
  lines.push(`|----------|-------|`);
  lines.push(`| Security | ${score.security}/100 |`);
  lines.push(`| Performance | ${score.performance}/100 |`);
  lines.push(`| Style | ${score.style}/100 |`);
  lines.push(`| **Overall** | **${score.overall}/100** |`);
  lines.push(``);

  if (findings.length === 0) {
    lines.push(`No issues found. Clean code!`);
  } else {
    const critical = findings.filter((f) => f.severity === "critical");
    const warnings = findings.filter((f) => f.severity === "warning");
    const infos = findings.filter((f) => f.severity === "info");

    if (critical.length > 0) {
      lines.push(`### 🔴 Critical (${critical.length})`);
      for (const f of critical) {
        lines.push(`- **[${f.category}]** ${f.file}${f.line ? `:${f.line}` : ""} — ${f.description}`);
        if (f.suggestion) lines.push(`  > ${f.suggestion}`);
      }
      lines.push(``);
    }

    if (warnings.length > 0) {
      lines.push(`### 🟡 Warnings (${warnings.length})`);
      for (const f of warnings) {
        lines.push(`- **[${f.category}]** ${f.file}${f.line ? `:${f.line}` : ""} — ${f.description}`);
        if (f.suggestion) lines.push(`  > ${f.suggestion}`);
      }
      lines.push(``);
    }

    if (infos.length > 0) {
      lines.push(`### 🔵 Info (${infos.length})`);
      for (const f of infos) {
        lines.push(`- **[${f.category}]** ${f.file}${f.line ? `:${f.line}` : ""} — ${f.description}`);
      }
    }
  }

  return lines.join("\n");
}
