/**
 * Built-in Hook Templates — pre-built compliance hooks that can be installed
 * with one click. Each template provides working code and a sensible default
 * configuration.
 */

import type { HookPoint, HookLanguage } from "../db/schema/hookExtensions.js";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface BuiltInHookTemplate {
  type: string;
  name: string;
  description: string;
  hookPoint: HookPoint;
  language: HookLanguage;
  code: string;
  defaultConfig: Record<string, unknown>;
  timeout: number;
}

// ─── PII Scrubber ───────────────────────────────────────────────────────────

const PII_SCRUBBER: BuiltInHookTemplate = {
  type: "PII_SCRUBBER",
  name: "PII Scrubber",
  description:
    "Regex-based PII detection and redaction. Catches emails, phone numbers, SSNs, and credit card numbers before content is indexed or delivered.",
  hookPoint: "pre_indexing",
  language: "javascript",
  code: `/**
 * PII Scrubber — redacts personally identifiable information.
 * @param {object} context - { content: string, config: object }
 * @returns {object} - { content: string, metadata: object }
 */
function handler(context) {
  const { content, config } = context;
  const redactChar = config.redactChar || '*';
  const patterns = {
    email: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}/g,
    phone: /(?:\\+?1[-.]?)?\\(?[0-9]{3}\\)?[-. ]?[0-9]{3}[-. ]?[0-9]{4}/g,
    ssn: /\\b\\d{3}-\\d{2}-\\d{4}\\b/g,
    creditCard: /\\b(?:\\d[ -]*?){13,19}\\b/g,
  };

  let scrubbed = content;
  const findings = {};

  for (const [type, regex] of Object.entries(patterns)) {
    if (config.disabledPatterns && config.disabledPatterns.includes(type)) continue;
    const matches = scrubbed.match(regex);
    if (matches) {
      findings[type] = matches.length;
      scrubbed = scrubbed.replace(regex, (m) => redactChar.repeat(m.length));
    }
  }

  return {
    content: scrubbed,
    metadata: { piiFindings: findings, totalRedacted: Object.values(findings).reduce((a, b) => a + b, 0) },
  };
}`,
  defaultConfig: {
    redactChar: "*",
    disabledPatterns: [],
  },
  timeout: 5000,
};

// ─── Content Filter ─────────────────────────────────────────────────────────

const CONTENT_FILTER: BuiltInHookTemplate = {
  type: "CONTENT_FILTER",
  name: "Content Filter",
  description:
    "Configurable keyword and phrase blocklist. Blocks or redacts content containing prohibited terms before delivery.",
  hookPoint: "pre_response",
  language: "javascript",
  code: `/**
 * Content Filter — blocklist-based content filtering.
 * @param {object} context - { content: string, config: object }
 * @returns {object} - { content: string, metadata: object }
 */
function handler(context) {
  const { content, config } = context;
  const blocklist = config.blocklist || [];
  const action = config.action || 'redact'; // 'redact' | 'block'
  const caseSensitive = config.caseSensitive || false;

  const flags = caseSensitive ? 'g' : 'gi';
  const found = [];
  let filtered = content;

  for (const term of blocklist) {
    const regex = new RegExp(term.replace(/[.*+?^\${}()|[\\]\\\\]/g, '\\\\$&'), flags);
    const matches = filtered.match(regex);
    if (matches) {
      found.push({ term, count: matches.length });
      if (action === 'block') {
        return {
          content: '[CONTENT BLOCKED — prohibited terms detected]',
          metadata: { blocked: true, matchedTerms: found },
        };
      }
      filtered = filtered.replace(regex, (m) => '[REDACTED]');
    }
  }

  return {
    content: filtered,
    metadata: { blocked: false, matchedTerms: found },
  };
}`,
  defaultConfig: {
    blocklist: [],
    action: "redact",
    caseSensitive: false,
  },
  timeout: 5000,
};

// ─── Query Transformer ──────────────────────────────────────────────────────

const QUERY_TRANSFORMER: BuiltInHookTemplate = {
  type: "QUERY_TRANSFORMER",
  name: "Query Transformer",
  description:
    "Cleans and restructures queries before the council sees them. Removes noise, normalises whitespace, applies prefix/suffix templates.",
  hookPoint: "pre_council",
  language: "javascript",
  code: `/**
 * Query Transformer — clean and restructure queries.
 * @param {object} context - { content: string, config: object }
 * @returns {object} - { content: string, metadata: object }
 */
function handler(context) {
  const { content, config } = context;
  let transformed = content;

  // Strip excessive whitespace
  transformed = transformed.replace(/\\s+/g, ' ').trim();

  // Remove configured noise patterns
  const noisePatterns = config.noisePatterns || [];
  for (const pattern of noisePatterns) {
    transformed = transformed.replace(new RegExp(pattern, 'gi'), '');
  }
  transformed = transformed.trim();

  // Apply prefix/suffix templates
  if (config.prefix) {
    transformed = config.prefix + ' ' + transformed;
  }
  if (config.suffix) {
    transformed = transformed + ' ' + config.suffix;
  }

  // Enforce max query length
  const maxLength = config.maxLength || 10000;
  const wasTruncated = transformed.length > maxLength;
  if (wasTruncated) {
    transformed = transformed.slice(0, maxLength);
  }

  return {
    content: transformed,
    metadata: { originalLength: content.length, transformedLength: transformed.length, wasTruncated },
  };
}`,
  defaultConfig: {
    noisePatterns: [],
    prefix: "",
    suffix: "",
    maxLength: 10000,
  },
  timeout: 3000,
};

// ─── Audit Logger ───────────────────────────────────────────────────────────

const AUDIT_LOGGER: BuiltInHookTemplate = {
  type: "AUDIT_LOGGER",
  name: "Audit Logger",
  description:
    "Logs all inputs and outputs for compliance auditing. Passes content through unchanged but records a structured audit entry.",
  hookPoint: "post_response",
  language: "javascript",
  code: `/**
 * Audit Logger — logs content for compliance without modifying it.
 * @param {object} context - { content: string, config: object }
 * @returns {object} - { content: string, metadata: object }
 */
function handler(context) {
  const { content, config } = context;

  const auditEntry = {
    timestamp: new Date().toISOString(),
    contentLength: content.length,
    contentHash: simpleHash(content),
    hookPoint: config._hookPoint || 'unknown',
    conversationId: config._conversationId || null,
  };

  // The hook system captures this metadata in execution logs.
  return {
    content: content, // Pass through unchanged
    metadata: { audit: auditEntry },
  };
}

function simpleHash(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return hash.toString(16);
}`,
  defaultConfig: {},
  timeout: 2000,
};

// ─── Length Guard ───────────────────────────────────────────────────────────

const LENGTH_GUARD: BuiltInHookTemplate = {
  type: "LENGTH_GUARD",
  name: "Length Guard",
  description:
    "Enforces maximum content length. Truncates or rejects content that exceeds the configured limit.",
  hookPoint: "pre_indexing",
  language: "javascript",
  code: `/**
 * Length Guard — enforces max content length.
 * @param {object} context - { content: string, config: object }
 * @returns {object} - { content: string, metadata: object }
 */
function handler(context) {
  const { content, config } = context;
  const maxLength = config.maxLength || 50000;
  const action = config.action || 'truncate'; // 'truncate' | 'reject'

  if (content.length <= maxLength) {
    return {
      content,
      metadata: { withinLimit: true, contentLength: content.length, maxLength },
    };
  }

  if (action === 'reject') {
    throw new Error('Content exceeds maximum length of ' + maxLength + ' characters (' + content.length + ' given)');
  }

  return {
    content: content.slice(0, maxLength),
    metadata: {
      withinLimit: false,
      originalLength: content.length,
      truncatedTo: maxLength,
      action: 'truncated',
    },
  };
}`,
  defaultConfig: {
    maxLength: 50000,
    action: "truncate",
  },
  timeout: 2000,
};

// ─── Export ─────────────────────────────────────────────────────────────────

export const builtInHooks: BuiltInHookTemplate[] = [
  PII_SCRUBBER,
  CONTENT_FILTER,
  QUERY_TRANSFORMER,
  AUDIT_LOGGER,
  LENGTH_GUARD,
];

export function getBuiltInHookByType(type: string): BuiltInHookTemplate | undefined {
  return builtInHooks.find((h) => h.type === type);
}
