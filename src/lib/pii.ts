export interface PIIDetection {
  found: boolean;
  types: string[];
  matches: { type: string; value: string; start: number; end: number; severity: 'low' | 'medium' | 'high' }[];
  anonymized: string;
  riskScore: number;
  recommendations: string[];
}

const PII_PATTERNS: { type: string; pattern: RegExp; severity: 'low' | 'medium' | 'high' }[] = [
  { type: "ssn", pattern: /\b\d{3}[-\s]?\d{2}[-\s]?\d{4}\b/g, severity: "high" },
  { type: "credit_card", pattern: /\b\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}\b/g, severity: "high" },
  { type: "bank_account", pattern: /\b(?:AC|Account)\s*:?\s*\d{8,17}\b/gi, severity: "high" },
  { type: "passport", pattern: /\b[A-Z]{1,2}\d{7,9}\b/g, severity: "high" },

  { type: "email", pattern: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, severity: "medium" },
  { type: "phone", pattern: /(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g, severity: "medium" },
  { type: "address", pattern: /\d+\s+[A-Za-z]+(?:\s[A-Za-z]+){0,2}\s+(?:Street|St|Avenue|Ave|Road|Rd|Drive|Dr|Lane|Ln|Boulevard|Blvd)\b/gi, severity: "medium" },
  { type: "date_of_birth", pattern: /\b(?:0[1-9]|1[0-2])[-/](?:0[1-9]|[12]\d|3[01])[-/](?:19|20)\d{2}\b/g, severity: "medium" },
  { type: "driver_license", pattern: /\b[A-Z]{1,2}\d{6,8}\b/g, severity: "medium" },

  { type: "ip_address", pattern: /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g, severity: "low" },
  { type: "url", pattern: /https?:\/\/[^\s]+/g, severity: "low" },
  { type: "name", pattern: /\b(?:Mr|Mrs|Ms|Dr|Prof)\.?\s+[A-Z][a-z]+\s+[A-Z][a-z]+\b/g, severity: "low" },
  { type: "company", pattern: /\b(?:Inc|LLC|Corp|Ltd)\.?\s+[A-Z][a-z]+\b/g, severity: "low" },
];

export function detectPII(text: string): PIIDetection {
  const matches: PIIDetection["matches"] = [];
  const types = new Set<string>();
  let riskScore = 0;

  for (const { type, pattern, severity } of PII_PATTERNS) {
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(text)) !== null) {
      matches.push({
        type,
        value: match[0],
        start: match.index,
        end: match.index + match[0].length,
        severity
      });
      types.add(type);

      if (severity === 'high') riskScore += 10;
      else if (severity === 'medium') riskScore += 5;
      else riskScore += 2;
    }
  }

  matches.sort((a, b) => b.start - a.start);

  let anonymized = text;
  for (const m of matches) {
    const placeholder = `[${m.type.toUpperCase()}_REDACTED]`;
    anonymized = anonymized.slice(0, m.start) + placeholder + anonymized.slice(m.end);
  }

  const recommendations = generateRecommendations(types, matches);

  const normalizedRiskScore = Math.min(riskScore, 100);

  return {
    found: matches.length > 0,
    types: Array.from(types),
    matches,
    anonymized,
    riskScore: normalizedRiskScore,
    recommendations
  };
}

function generateRecommendations(types: Set<string>, matches: PIIDetection["matches"]): string[] {
  const recommendations: string[] = [];

  if (types.has('email')) {
    recommendations.push("Remove email addresses or use placeholder format (e.g., user@example.com)");
  }

  if (types.has('phone')) {
    recommendations.push("Replace phone numbers with generic format (e.g., XXX-XXX-XXXX)");
  }

  if (types.has('ssn') || types.has('credit_card') || types.has('bank_account')) {
    recommendations.push("⚠️ HIGH RISK: Remove sensitive financial/identification information immediately");
  }

  if (types.has('address')) {
    recommendations.push("Generalize addresses (e.g., use 'a residential address' instead)");
  }

  if (types.has('name')) {
    recommendations.push("Use pseudonyms or generic names instead of real names");
  }

  const highSeverityCount = matches.filter(m => m.severity === 'high').length;
  if (highSeverityCount > 0) {
    recommendations.push(`🚨 CRITICAL: ${highSeverityCount} high-sensitivity PII items detected`);
  }

  if (types.size > 3) {
    recommendations.push("Consider rewriting the query to avoid including personal information");
  }

  recommendations.push("Review the anonymized version before proceeding");

  return recommendations;
}

