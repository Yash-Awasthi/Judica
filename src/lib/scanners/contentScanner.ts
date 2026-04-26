/**
 * Content Scanners — Phase 1.1
 *
 * Scanner pipeline modeled after LLM Guard (MIT, protectai/llm-guard).
 * LLM Guard uses a scanner interface: each scanner receives text, returns
 * { sanitized, isValid, risk_score }. We mirror that pattern in TypeScript,
 * plugged into the existing guardrails system.
 *
 * Ref: https://github.com/protectai/llm-guard
 */

export interface ScanResult {
  isValid: boolean;
  sanitized: string;
  riskScore: number; // 0.0 = clean, 1.0 = definitely blocked
  scanner: string;
  detail?: string;
}

export interface Scanner {
  name: string;
  scan(text: string): ScanResult;
}

// ─── Profanity Scanner ───────────────────────────────────────────────────────
// Mirrors LLM Guard's BanSubstrings scanner pattern.
// Word list sourced from community-maintained lists (same approach as LLM Guard).
const PROFANITY_PATTERNS: RegExp[] = [
  /\bf{1,8}u{1,8}c{1,8}k{1,8}\b/gi,
  /\bs{1,8}h{1,8}i{1,8}t{1,8}\b/gi,
  /\ba{1,8}s{1,8}s{1,8}h{1,8}o{1,8}l{1,8}e{1,8}\b/gi,
  /\bb{1,8}i{1,8}t{1,8}c{1,8}h{1,8}\b/gi,
  /\bc{1,8}u{1,8}n{1,8}t{1,8}\b/gi,
  /\bd{1,8}i{1,8}c{1,8}k{1,8}\b/gi,
  /\bp{1,8}r{1,8}i{1,8}c{1,8}k{1,8}\b/gi,
  /\bw{1,8}h{1,8}o{1,8}r{1,8}e{1,8}\b/gi,
  /\bb{1,8}a{1,8}s{1,8}t{1,8}a{1,8}r{1,8}d{1,8}\b/gi,
  /\bd{1,8}a{1,8}m{1,8}n{1,8}\b/gi,
  /\bc{1,8}r{1,8}a{1,8}p{1,8}\b/gi,
  /\bb{1,8}u{1,8}l{1,8}l{1,8}s{1,8}h{1,8}i{1,8}t{1,8}\b/gi,
  /\bm{1,8}o{1,8}t{1,8}h{1,8}e{1,8}r{1,8}f{1,8}u{1,8}c{1,8}k{1,8}e{1,8}r{1,8}\b/gi,
  /\bn{1,8}i{1,8}g{1,8}g{1,8}e{1,8}r{1,8}\b/gi,
  /\bf{1,8}a{1,8}g{1,8}g{1,8}o{1,8}t{1,8}\b/gi,
  /\br{1,8}e{1,8}t{1,8}a{1,8}r{1,8}d{1,8}\b/gi,
];

export class ProfanityScanner implements Scanner {
  name = "ProfanityScanner";

  scan(text: string): ScanResult {
    let sanitized = text;
    let found = 0;

    for (const pattern of PROFANITY_PATTERNS) {
      const matched = sanitized.match(pattern);
      if (matched) {
        found += matched.length;
        // Replace with asterisks of same length — mirrors LLM Guard redaction
        sanitized = sanitized.replace(pattern, (m) => "*".repeat(m.length));
      }
    }

    const riskScore = found > 0 ? Math.min(found * 0.2, 1.0) : 0;

    return {
      isValid: found === 0,
      sanitized,
      riskScore,
      scanner: this.name,
      detail: found > 0 ? `${found} profanity match(es) found and redacted` : undefined,
    };
  }
}

// ─── Adult Content Scanner ───────────────────────────────────────────────────
// Mirrors LLM Guard's BanTopics scanner using keyword/pattern matching.
// For production, this would call Perspective API or a local classifier.
// Stub: pattern-based detection; env var PERSPECTIVE_API_KEY wires the real API.
const ADULT_CONTENT_PATTERNS: RegExp[] = [
  /\b(explicit|sexually\s+explicit|adult\s+content|pornograph(y|ic)|nsfw)\b/gi,
  /\b(nude|nudity|naked|genital|penis|vagina|breasts?|nipple)\b/gi,
  /\b(masturbat|orgasm|ejaculat|erect(ion)?|aroused)\b/gi,
  /\b(sex\s+act|sexual\s+intercourse|making\s+love)\b/gi,
  /\b(hentai|xxx|x-rated|18\+\s+content)\b/gi,
];

export class AdultContentScanner implements Scanner {
  name = "AdultContentScanner";

  scan(text: string): ScanResult {
    let found = 0;

    for (const pattern of ADULT_CONTENT_PATTERNS) {
      if (pattern.test(text)) found++;
    }

    const riskScore = found > 0 ? Math.min(found * 0.35, 1.0) : 0;

    return {
      isValid: found === 0,
      sanitized: text, // Block, don't redact — return original; caller decides
      riskScore,
      scanner: this.name,
      detail: found > 0 ? `Adult/explicit content detected (${found} signal(s))` : undefined,
    };
  }
}

// ─── Scanner Pipeline ────────────────────────────────────────────────────────
// Mirrors LLM Guard's pipeline: run all active scanners, aggregate results.
export interface PipelineResult {
  isValid: boolean;
  sanitized: string;
  maxRiskScore: number;
  results: ScanResult[];
}

export function runScannerPipeline(
  text: string,
  scanners: Scanner[],
): PipelineResult {
  let current = text;
  let isValid = true;
  let maxRiskScore = 0;
  const results: ScanResult[] = [];

  for (const scanner of scanners) {
    const result = scanner.scan(current);
    results.push(result);

    if (result.riskScore > maxRiskScore) maxRiskScore = result.riskScore;

    if (!result.isValid) {
      isValid = false;
      // Pass sanitized text to next scanner (redaction chains)
      if (result.sanitized !== current) {
        current = result.sanitized;
      }
    }
  }

  return { isValid, sanitized: current, maxRiskScore, results };
}

// ─── User-setting-driven factory ─────────────────────────────────────────────
export interface ContentFilterSettings {
  blockProfanity?: boolean;
  blockAdultContent?: boolean;
}

/**
 * Build the active scanner list from per-user settings.
 * Both filters are OFF by default per the cost/opt-in principle.
 */
export function buildUserScanners(settings: ContentFilterSettings): Scanner[] {
  const scanners: Scanner[] = [];
  if (settings.blockProfanity) scanners.push(new ProfanityScanner());
  if (settings.blockAdultContent) scanners.push(new AdultContentScanner());
  return scanners;
}
