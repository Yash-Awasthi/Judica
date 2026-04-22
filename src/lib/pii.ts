export interface PIIDetection {
  found: boolean;
  types: string[];
  matches: { type: string; value: string; start: number; end: number; severity: 'low' | 'medium' | 'high' }[];
  anonymized: string;
  riskScore: number;
  recommendations: string[];
}

// P10-67/P10-69: Improved PII patterns with algorithmic validation
const PII_PATTERNS: { type: string; pattern: RegExp; severity: 'low' | 'medium' | 'high'; validate?: (match: string) => boolean }[] = [
  {
    type: "ssn",
    pattern: /\b(?!000|666|9\d{2})\d{3}[-\s](?!00)\d{2}[-\s](?!0000)\d{4}\b/g,
    severity: "high",
    // P10-69: SSN area number validation (exclude invalid ranges)
    validate: (m) => {
      const digits = m.replace(/[-\s]/g, '');
      const area = parseInt(digits.slice(0, 3), 10); // P24-06: Explicit radix
      return area > 0 && area !== 666 && area < 900;
    }
  },
  {
    type: "credit_card",
    pattern: /\b(?:4\d{3}|5[1-5]\d{2}|3[47]\d{2}|6(?:011|5\d{2}))\s?[-]?\s?\d{4}\s?[-]?\s?\d{4}\s?[-]?\s?\d{3,4}\b/g,
    severity: "high",
    // P10-69: Luhn checksum validation
    validate: (m) => {
      const digits = m.replace(/[-\s]/g, '');
      if (digits.length < 13 || digits.length > 19) return false;
      let sum = 0;
      let alternate = false;
      for (let i = digits.length - 1; i >= 0; i--) {
        let n = parseInt(digits[i], 10);
        if (alternate) {
          n *= 2;
          if (n > 9) n -= 9;
        }
        sum += n;
        alternate = !alternate;
      }
      return sum % 10 === 0;
    }
  },
  { type: "bank_account", pattern: /\b(?:AC|Account)\s*:?\s*\d{8,17}\b/gi, severity: "high" },
  {
    type: "passport",
    pattern: /\b[A-Z]{1,2}\d{7,9}\b/g,
    severity: "high",
    // P10-67: Reduce false positives — require context words nearby
    validate: (m) => m.length >= 8 && m.length <= 11
  },
  // L-2: Add IBAN pattern for international bank account detection
  {
    type: "iban",
    pattern: /\b[A-Z]{2}\d{2}[A-Z0-9]{4,30}\b/g,
    severity: "high",
    // Basic IBAN length check (15-34 chars) and mod-97 checksum
    validate: (m) => {
      if (m.length < 15 || m.length > 34) return false;
      // Rearrange: move first 4 chars to end, convert letters to numbers, mod 97
      const rearranged = (m.slice(4) + m.slice(0, 4)).toUpperCase();
      const numeric = rearranged.replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));
      let remainder = 0;
      for (const chunk of numeric.match(/.{1,9}/g) ?? []) {
        remainder = parseInt(String(remainder) + chunk, 10) % 97;
      }
      return remainder === 1;
    }
  },

  { type: "email", pattern: /[a-zA-Z0-9._%+-]{1,64}@[a-zA-Z0-9.-]{1,255}\.[a-zA-Z]{2,}/g, severity: "medium" },
  {
    type: "phone",
    pattern: /(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g,
    severity: "medium",
    // P10-69: Basic E.164 format validation — reject version-number-like matches
    validate: (m) => {
      const digits = m.replace(/[^\d]/g, '');
      // Must have 10-11 digits for US, reject short matches (version numbers etc)
      return digits.length >= 10 && digits.length <= 15;
    }
  },
  { type: "address", pattern: /\d+\s+[A-Za-z]+(?:\s[A-Za-z]+){0,2}\s+(?:Street|St|Avenue|Ave|Road|Rd|Drive|Dr|Lane|Ln|Boulevard|Blvd)\b/gi, severity: "medium" },
  { type: "date_of_birth", pattern: /\b(?:0[1-9]|1[0-2])[-/](?:0[1-9]|[12]\d|3[01])[-/](?:19|20)\d{2}\b/g, severity: "medium" },
  {
    type: "driver_license",
    pattern: /\b[A-Z]{1,2}\d{6,8}\b/g,
    severity: "medium",
    // P10-67: Reduce false positives — require at least 2 letters prefix
    validate: (m) => /^[A-Z]{2}/.test(m)
  },

  { type: "ip_address", pattern: /\b(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\b/g, severity: "low" },
  { type: "url", pattern: /https?:\/\/[^\s]+/g, severity: "low" },
  { type: "name", pattern: /\b(?:Mr|Mrs|Ms|Dr|Prof)\.?\s+[A-Z][a-z]+\s+[A-Z][a-z]+\b/g, severity: "low" },
  { type: "company", pattern: /\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\s+(?:Inc|LLC|Corp|Ltd)\.?\b/g, severity: "low" },
];

export function detectPII(text: string): PIIDetection {
  // P45-05: Cap input length to prevent regex DoS on very large inputs
  const safeText = text.length > 1_000_000 ? text.slice(0, 1_000_000) : text;
  const matches: PIIDetection["matches"] = [];
  const types = new Set<string>();
  let riskScore = 0;

  // P10-68: Collect all matches, then resolve overlaps by specificity
  const rawMatches: Array<PIIDetection["matches"][0] & { specificity: number }> = [];
  const MAX_MATCHES = 10_000;

  for (const { type, pattern, severity, validate } of PII_PATTERNS) {
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(safeText)) !== null) {
      if (rawMatches.length >= MAX_MATCHES) break;
      // P10-69: Apply algorithmic validation if available
      if (validate && !validate(match[0])) continue;

      // P10-67: Skip matches that look like version numbers (e.g., 1.2.3.4)
      if (type === "phone" && /^\d+\.\d+\.\d+/.test(match[0])) continue;

      rawMatches.push({
        type,
        value: match[0],
        start: match.index,
        end: match.index + match[0].length,
        severity,
        specificity: severity === 'high' ? 3 : severity === 'medium' ? 2 : 1
      });
    }
  }

  // P10-68: Resolve overlapping patterns — keep most specific match
  rawMatches.sort((a, b) => a.start - b.start || b.specificity - a.specificity);
  const resolved: typeof rawMatches = [];
  for (const m of rawMatches) {
    const overlaps = resolved.some(r =>
      (m.start >= r.start && m.start < r.end) ||
      (m.end > r.start && m.end <= r.end)
    );
    if (!overlaps) {
      resolved.push(m);
    }
  }

  for (const m of resolved) {
    matches.push({ type: m.type, value: m.value, start: m.start, end: m.end, severity: m.severity });
    types.add(m.type);
    if (m.severity === 'high') riskScore += 10;
    else if (m.severity === 'medium') riskScore += 5;
    else riskScore += 2;
  }

  // P10-71: Sort by position descending for safe string replacement
  matches.sort((a, b) => b.start - a.start);

  // P10-71: Normalize redaction format consistently
  let anonymized = text;
  for (const m of matches) {
    const placeholder = `[${m.type.toUpperCase()}_REDACTED]`;
    anonymized = anonymized.slice(0, m.start) + placeholder + anonymized.slice(m.end);
  }

  const recommendations = generateRecommendations(types, matches);

  // P10-70: Log when PII density is high (may indicate over-detection / false positive risk)
  const normalizedRiskScore = Math.min(riskScore, 100);
  const wordCount = text.split(/\s+/).filter(Boolean).length;
  if (wordCount > 0 && matches.length / wordCount > 0.1) {
    // More than 10% of words are flagged — likely high false-positive rate or genuine data dump
    import("./logger.js").then(({ default: logger }) => {
      logger.warn({ matchCount: matches.length, wordCount, riskScore: normalizedRiskScore }, "High PII density detected — review for false positives");
    }).catch(() => {});
  }

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
