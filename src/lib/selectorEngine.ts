/**
 * Selector Engine — Phase 3.12
 *
 * Core engine for natural language → CSS/XPath selector resolution.
 * Converts HTML to a simplified DOM tree suitable for LLM context,
 * builds prompts, extracts content, and scores selector confidence.
 *
 * Zero-dependency HTML processing: regex-based lightweight parser.
 * Production upgrade: use linkedom or cheerio for full DOM support.
 */

import { routeAndCollect } from "../router/smartRouter.js";
import type { AdapterMessage } from "../adapters/types.js";
import logger from "./logger.js";

/* ── Types ─────────────────────────────────────────────────────────── */

export interface SimplifiedNode {
  tag: string;
  id?: string;
  classes?: string[];
  role?: string;
  ariaLabel?: string;
  text?: string;
  href?: string;
  src?: string;
  name?: string;
  type?: string;
  placeholder?: string;
  children?: SimplifiedNode[];
  /** Depth in tree — used for truncation */
  depth: number;
}

export interface CandidateSelector {
  selector: string;
  type: "css" | "xpath" | "aria";
  confidence: number;
  reasoning: string;
}

export interface ExtractionResult {
  matched: boolean;
  content: string | null;
  matchCount: number;
}

/* ── DOM Simplification ────────────────────────────────────────────── */

/** Tags to completely skip when building the simplified tree */
const SKIP_TAGS = new Set([
  "script", "style", "noscript", "svg", "path", "meta", "link",
  "head", "br", "hr", "picture", "source", "track",
]);

/** HTML void elements (self-closing, no end tag) */
const VOID_TAGS = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input",
  "link", "meta", "param", "source", "track", "wbr",
]);

/** Tags considered structural but not interesting content */
const STRUCTURAL_TAGS = new Set([
  "div", "span", "section", "article", "main", "aside", "header",
  "footer", "nav", "ul", "ol", "li", "table", "thead", "tbody",
  "tr", "td", "th", "form", "fieldset", "label",
]);

/** Tags that carry semantic/interactive meaning */
const SEMANTIC_TAGS = new Set([
  "a", "button", "input", "select", "textarea", "h1", "h2", "h3",
  "h4", "h5", "h6", "p", "img", "video", "audio", "iframe",
]);

/**
 * Parse raw HTML into a simplified tree structure suitable for LLM context.
 * Strips scripts, styles, and non-content elements. Limits depth to keep
 * token count manageable.
 */
export function parseDomToSimplifiedTree(html: string, maxDepth = 6): SimplifiedNode[] {
  // Strip comments, scripts, styles first
  let cleaned = html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, "");

  const nodes: SimplifiedNode[] = [];
  parseChildren(cleaned, nodes, 0, maxDepth);
  return nodes;
}

function parseChildren(html: string, nodes: SimplifiedNode[], depth: number, maxDepth: number): void {
  if (depth > maxDepth) return;

  // Match both normal tags and void/self-closing tags
  const tagRegex = /<(\w+)([^>]*?)(?:\/>|>(?:([\s\S]*?)<\/\1>)?)/gi;
  let match: RegExpExecArray | null;

  while ((match = tagRegex.exec(html)) !== null) {
    const [, tagName, attrs, innerHtml] = match;
    const tag = tagName.toLowerCase();

    if (SKIP_TAGS.has(tag)) continue;

    const node: SimplifiedNode = { tag, depth };

    // Extract common attributes
    const idMatch = attrs.match(/\bid=["']([^"']+)["']/i);
    if (idMatch) node.id = idMatch[1];

    const classMatch = attrs.match(/\bclass=["']([^"']+)["']/i);
    if (classMatch) node.classes = classMatch[1].split(/\s+/).filter(Boolean);

    const roleMatch = attrs.match(/\brole=["']([^"']+)["']/i);
    if (roleMatch) node.role = roleMatch[1];

    const ariaMatch = attrs.match(/\baria-label=["']([^"']+)["']/i);
    if (ariaMatch) node.ariaLabel = ariaMatch[1];

    const hrefMatch = attrs.match(/\bhref=["']([^"']+)["']/i);
    if (hrefMatch) node.href = hrefMatch[1];

    const nameMatch = attrs.match(/\bname=["']([^"']+)["']/i);
    if (nameMatch) node.name = nameMatch[1];

    const typeMatch = attrs.match(/\btype=["']([^"']+)["']/i);
    if (typeMatch) node.type = typeMatch[1];

    const placeholderMatch = attrs.match(/\bplaceholder=["']([^"']+)["']/i);
    if (placeholderMatch) node.placeholder = placeholderMatch[1];

    // Extract text content (first 200 chars, no nested tags)
    if (innerHtml) {
      const textOnly = innerHtml.replace(/<[^>]+>/g, "").trim();
      if (textOnly) node.text = textOnly.substring(0, 200);
    }

    // Recurse into children
    if (innerHtml && depth < maxDepth) {
      const children: SimplifiedNode[] = [];
      parseChildren(innerHtml, children, depth + 1, maxDepth);
      if (children.length > 0) node.children = children;
    }

    nodes.push(node);
  }
}

/**
 * Serialize simplified tree to a compact string for LLM context.
 * Uses indentation to show hierarchy, includes only relevant attributes.
 */
export function serializeTree(nodes: SimplifiedNode[], indent = 0): string {
  const lines: string[] = [];
  const pad = "  ".repeat(indent);

  for (const node of nodes) {
    const attrs: string[] = [];
    if (node.id) attrs.push(`id="${node.id}"`);
    if (node.classes?.length) attrs.push(`class="${node.classes.join(" ")}"`);
    if (node.role) attrs.push(`role="${node.role}"`);
    if (node.ariaLabel) attrs.push(`aria-label="${node.ariaLabel}"`);
    if (node.href) attrs.push(`href="${node.href}"`);
    if (node.name) attrs.push(`name="${node.name}"`);
    if (node.type) attrs.push(`type="${node.type}"`);
    if (node.placeholder) attrs.push(`placeholder="${node.placeholder}"`);

    const attrStr = attrs.length > 0 ? " " + attrs.join(" ") : "";
    const text = node.text ? `: "${node.text.substring(0, 100)}"` : "";

    lines.push(`${pad}<${node.tag}${attrStr}>${text}`);

    if (node.children) {
      lines.push(serializeTree(node.children, indent + 1));
    }
  }

  return lines.join("\n");
}

/* ── LLM Prompt Construction ──────────────────────────────────────── */

/**
 * Build a prompt for the LLM to generate CSS/XPath selectors from a
 * natural language description and simplified DOM tree.
 */
export function buildSelectorPrompt(description: string, simplifiedDom: string): {
  system: string;
  user: string;
} {
  const system = `You are an expert web selector engineer. Given a simplified DOM tree and a natural language description of what the user wants to select, generate the best CSS selector, XPath expression, or ARIA selector to match the described element(s).

Rules:
1. Prefer CSS selectors when possible — they are faster and more widely supported.
2. Use XPath only when CSS cannot express the query (e.g. text content matching, parent traversal).
3. Use ARIA selectors (role + aria-label) for accessibility-oriented queries.
4. Generate multiple candidates ranked by confidence (0-1 scale).
5. Each candidate must include a brief reasoning.
6. Prefer selectors that are resilient to minor DOM changes (avoid brittle positional selectors like nth-child unless necessary).
7. Prefer id-based selectors when available, then class-based, then attribute-based.

Respond with ONLY a JSON array of objects, no other text:
[
  {
    "selector": "css or xpath expression",
    "type": "css" | "xpath" | "aria",
    "confidence": 0.0-1.0,
    "reasoning": "brief explanation"
  }
]`;

  const user = `Description: "${description}"

Simplified DOM:
${simplifiedDom}`;

  return { system, user };
}

/* ── Selector Extraction ──────────────────────────────────────────── */

/**
 * Apply a CSS selector to HTML and extract matching content.
 * Uses regex-based lightweight matching for common selector patterns.
 * Production upgrade: use linkedom for full CSS selector support.
 */
export function extractWithSelector(html: string, selector: string, type: "css" | "xpath" | "aria"): ExtractionResult {
  try {
    if (type === "css") {
      return extractWithCss(html, selector);
    } else if (type === "xpath") {
      return extractWithXpath(html, selector);
    } else if (type === "aria") {
      return extractWithAria(html, selector);
    }
    return { matched: false, content: null, matchCount: 0 };
  } catch (err) {
    logger.warn({ err, selector, type }, "Selector extraction failed");
    return { matched: false, content: null, matchCount: 0 };
  }
}

/**
 * Lightweight CSS selector extraction using regex.
 * Handles: tag, #id, .class, [attr], [attr="value"], tag.class, tag#id combinations.
 * Supports both normal elements and void/self-closing elements (input, img, etc).
 */
function extractWithCss(html: string, selector: string): ExtractionResult {
  // Parse selector into parts
  const parts = parseCssSelector(selector);
  if (!parts) return { matched: false, content: null, matchCount: 0 };

  const { tag, id, classes, attrs } = parts;

  // Build regex for matching opening tags
  let openTagPattern = "<";
  if (tag && tag !== "*") {
    openTagPattern += tag;
  } else {
    openTagPattern += "\\w+";
  }
  openTagPattern += "\\b[^>]*";

  // Add attribute constraints
  if (id) {
    openTagPattern += `(?=[^>]*\\bid=["']${escapeRegex(id)}["'])`;
  }
  for (const cls of classes) {
    openTagPattern += `(?=[^>]*\\bclass=["'][^"']*\\b${escapeRegex(cls)}\\b[^"']*["'])`;
  }
  for (const [attr, val] of attrs) {
    if (val !== undefined) {
      openTagPattern += `(?=[^>]*\\b${escapeRegex(attr)}=["']${escapeRegex(val)}["'])`;
    } else {
      openTagPattern += `(?=[^>]*\\b${escapeRegex(attr)}(?:=|\\s|>))`;
    }
  }

  // Check if this is a void element selector
  const isVoid = tag ? VOID_TAGS.has(tag) : false;

  if (isVoid) {
    // Void elements: match just the opening tag
    const pattern = openTagPattern + "[^>]*\\/?>",
    regex = new RegExp(pattern, "gi");
    const matches: string[] = [];
    let m: RegExpExecArray | null;

    while ((m = regex.exec(html)) !== null && matches.length < 50) {
      // For void elements, return the tag itself as content (attribute summary)
      const tagStr = m[0];
      const placeholder = tagStr.match(/placeholder=["']([^"']+)["']/)?.[1];
      const value = tagStr.match(/value=["']([^"']+)["']/)?.[1];
      const ariaLabel = tagStr.match(/aria-label=["']([^"']+)["']/)?.[1];
      const alt = tagStr.match(/alt=["']([^"']+)["']/)?.[1];
      matches.push(placeholder || value || ariaLabel || alt || tagStr);
    }

    return {
      matched: matches.length > 0,
      content: matches.join("\n---\n") || null,
      matchCount: matches.length,
    };
  }

  // Normal elements: match opening tag + content + closing tag
  let pattern = openTagPattern + "[^>]*>([\\s\\S]*?)";
  if (tag && tag !== "*") {
    pattern += `</${tag}>`;
  } else {
    pattern += "<\\/\\w+>";
  }

  const regex = new RegExp(pattern, "gi");
  const matches: string[] = [];
  let m: RegExpExecArray | null;

  while ((m = regex.exec(html)) !== null && matches.length < 50) {
    const textContent = m[1]?.replace(/<[^>]+>/g, "").trim();
    if (textContent) matches.push(textContent);
  }

  return {
    matched: matches.length > 0,
    content: matches.join("\n---\n") || null,
    matchCount: matches.length,
  };
}

interface CssSelectorParts {
  tag: string | null;
  id: string | null;
  classes: string[];
  attrs: [string, string | undefined][];
}

function parseCssSelector(selector: string): CssSelectorParts | null {
  try {
    let tag: string | null = null;
    let id: string | null = null;
    const classes: string[] = [];
    const attrs: [string, string | undefined][] = [];

    // Take just the last simple selector if there are combinators
    const parts = selector.trim().split(/\s+/);
    const last = parts[parts.length - 1];

    // Tag
    const tagMatch = last.match(/^(\w+)/);
    if (tagMatch) tag = tagMatch[1];

    // ID
    const idMatch = last.match(/#([\w-]+)/);
    if (idMatch) id = idMatch[1];

    // Classes
    const classMatches = last.matchAll(/\.([\w-]+)/g);
    for (const cm of classMatches) {
      classes.push(cm[1]);
    }

    // Attribute selectors
    const attrMatches = last.matchAll(/\[(\w[\w-]*)(?:=["']([^"']*)["'])?\]/g);
    for (const am of attrMatches) {
      attrs.push([am[1], am[2]]);
    }

    return { tag, id, classes, attrs };
  } catch {
    return null;
  }
}

/**
 * Lightweight XPath extraction using regex for common patterns.
 * Handles: //tag, //tag[@attr='value'], //tag[contains(text(), 'x')]
 * Supports void elements (input, img, etc).
 */
function extractWithXpath(html: string, xpath: string): ExtractionResult {
  // Extract tag and predicate from XPath
  const xpathMatch = xpath.match(/\/\/(\w+)(?:\[(.+)\])?/);
  if (!xpathMatch) return { matched: false, content: null, matchCount: 0 };

  const [, tag, predicate] = xpathMatch;
  const isVoid = VOID_TAGS.has(tag.toLowerCase());

  let pattern = `<${tag}\\b`;

  if (predicate) {
    // Handle @attr='value'
    const attrMatch = predicate.match(/@(\w[\w-]*)=['"]([^'"]+)['"]/);
    if (attrMatch) {
      pattern += `[^>]*\\b${escapeRegex(attrMatch[1])}=["']${escapeRegex(attrMatch[2])}["']`;
    }

    // Handle contains(text(), 'x') — only for non-void elements
    const textMatch = predicate.match(/contains\s*\(\s*text\s*\(\s*\)\s*,\s*['"]([^'"]+)['"]\s*\)/);
    if (textMatch && !isVoid) {
      pattern += `[^>]*>[\\s\\S]*?${escapeRegex(textMatch[1])}[\\s\\S]*?</${tag}>`;
      const regex = new RegExp(pattern, "gi");
      const matches: string[] = [];
      let m: RegExpExecArray | null;

      while ((m = regex.exec(html)) !== null && matches.length < 50) {
        const fullMatch = m[0];
        const textContent = fullMatch.replace(/<[^>]+>/g, "").trim();
        if (textContent) matches.push(textContent);
      }

      return {
        matched: matches.length > 0,
        content: matches.join("\n---\n") || null,
        matchCount: matches.length,
      };
    }
  }

  if (isVoid) {
    // Void elements: match just the opening tag
    pattern += `[^>]*\\/?>`;
    const regex = new RegExp(pattern, "gi");
    const matches: string[] = [];
    let m: RegExpExecArray | null;

    while ((m = regex.exec(html)) !== null && matches.length < 50) {
      const tagStr = m[0];
      const placeholder = tagStr.match(/placeholder=["']([^"']+)["']/)?.[1];
      const value = tagStr.match(/value=["']([^"']+)["']/)?.[1];
      const ariaLabel = tagStr.match(/aria-label=["']([^"']+)["']/)?.[1];
      matches.push(placeholder || value || ariaLabel || tagStr);
    }

    return {
      matched: matches.length > 0,
      content: matches.join("\n---\n") || null,
      matchCount: matches.length,
    };
  }

  pattern += `[^>]*>([\\s\\S]*?)</${tag}>`;

  const regex = new RegExp(pattern, "gi");
  const matches: string[] = [];
  let m: RegExpExecArray | null;

  while ((m = regex.exec(html)) !== null && matches.length < 50) {
    const textContent = m[1]?.replace(/<[^>]+>/g, "").trim();
    if (textContent) matches.push(textContent);
  }

  return {
    matched: matches.length > 0,
    content: matches.join("\n---\n") || null,
    matchCount: matches.length,
  };
}

/**
 * ARIA selector extraction: matches elements by role and/or aria-label.
 * Selector format: "role=button" or "role=button,aria-label=Submit"
 */
function extractWithAria(html: string, selector: string): ExtractionResult {
  const parts = selector.split(",").map(p => p.trim());
  let pattern = "<\\w+\\b[^>]*";

  for (const part of parts) {
    const [key, value] = part.split("=").map(s => s.trim());
    if (key && value) {
      pattern += `(?=[^>]*\\b${escapeRegex(key)}=["']${escapeRegex(value)}["'])`;
    }
  }

  pattern += "[^>]*>([\\s\\S]*?)<\\/\\w+>";

  const regex = new RegExp(pattern, "gi");
  const matches: string[] = [];
  let m: RegExpExecArray | null;

  while ((m = regex.exec(html)) !== null && matches.length < 50) {
    const textContent = m[1]?.replace(/<[^>]+>/g, "").trim();
    if (textContent) matches.push(textContent);
  }

  return {
    matched: matches.length > 0,
    content: matches.join("\n---\n") || null,
    matchCount: matches.length,
  };
}

/* ── Confidence Scoring ───────────────────────────────────────────── */

/**
 * Score how well a selector matches the intent described in natural language.
 * Uses heuristics + optional LLM validation.
 */
export function scoreSelectorConfidence(
  selector: string,
  html: string,
  description: string,
): number {
  const extraction = extractWithSelector(html, selector, inferSelectorType(selector));

  if (!extraction.matched) return 0;

  let score = 0.3; // Base score for matching something

  // Bonus for reasonable match count (1-5 matches is usually ideal)
  if (extraction.matchCount === 1) score += 0.3;
  else if (extraction.matchCount <= 5) score += 0.2;
  else if (extraction.matchCount <= 20) score += 0.1;

  // Bonus for content overlap with description keywords
  if (extraction.content) {
    const descWords = description.toLowerCase().split(/\s+/).filter(w => w.length > 3);
    const contentLower = extraction.content.toLowerCase();
    const overlap = descWords.filter(w => contentLower.includes(w)).length;
    const overlapRatio = descWords.length > 0 ? overlap / descWords.length : 0;
    score += overlapRatio * 0.3;
  }

  // Bonus for using stable selectors (id, role, aria-label)
  if (selector.includes("#")) score += 0.05;
  if (selector.includes("role=")) score += 0.05;
  if (selector.includes("aria-label")) score += 0.05;

  return Math.min(score, 1);
}

/**
 * Infer selector type from the selector string.
 */
export function inferSelectorType(selector: string): "css" | "xpath" | "aria" {
  if (selector.startsWith("//") || selector.startsWith("(//")) return "xpath";
  if (selector.includes("role=") && !selector.startsWith(".") && !selector.startsWith("#") && !selector.startsWith("[")) return "aria";
  return "css";
}

/* ── LLM-Based Resolution ─────────────────────────────────────────── */

/**
 * Call the LLM to generate candidate selectors from a natural language
 * description and simplified DOM.
 */
export async function generateCandidateSelectors(
  description: string,
  html: string,
): Promise<CandidateSelector[]> {
  const tree = parseDomToSimplifiedTree(html);
  const serialized = serializeTree(tree);

  // Truncate to ~8k chars to stay within token limits
  const truncated = serialized.length > 8000
    ? serialized.substring(0, 8000) + "\n... (truncated)"
    : serialized;

  const { system, user } = buildSelectorPrompt(description, truncated);

  const messages: AdapterMessage[] = [
    { role: "system", content: system },
    { role: "user", content: user },
  ];

  try {
    const result = await routeAndCollect({
      model: "auto",
      messages,
      temperature: 0.2,
      max_tokens: 2048,
    });

    const jsonMatch = result.text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      logger.warn({ response: result.text.substring(0, 200) }, "LLM did not return JSON array for selectors");
      return [];
    }

    const parsed = JSON.parse(jsonMatch[0]);
    if (!Array.isArray(parsed)) return [];

    return parsed
      .filter((c: any) =>
        typeof c.selector === "string" &&
        typeof c.type === "string" &&
        typeof c.confidence === "number" &&
        ["css", "xpath", "aria"].includes(c.type)
      )
      .map((c: any) => ({
        selector: c.selector,
        type: c.type as "css" | "xpath" | "aria",
        confidence: Math.max(0, Math.min(1, c.confidence)),
        reasoning: c.reasoning || "",
      }))
      .sort((a: CandidateSelector, b: CandidateSelector) => b.confidence - a.confidence);
  } catch (err) {
    logger.error({ err }, "Failed to generate candidate selectors via LLM");
    return [];
  }
}

/**
 * Self-healing resolution: re-resolve a selector using the previous
 * selector as context for the LLM to understand what changed.
 */
export async function selfHealingResolve(
  description: string,
  html: string,
  previousSelector: string | null,
): Promise<CandidateSelector[]> {
  const tree = parseDomToSimplifiedTree(html);
  const serialized = serializeTree(tree);

  const truncated = serialized.length > 8000
    ? serialized.substring(0, 8000) + "\n... (truncated)"
    : serialized;

  const previousContext = previousSelector
    ? `\n\nPrevious selector that no longer works: "${previousSelector}"\nThe page may have been redesigned. Find the equivalent element in the new DOM.`
    : "";

  const system = `You are an expert web selector engineer specializing in self-healing selectors. Given a simplified DOM tree and a description of the target element, generate CSS/XPath/ARIA selectors that will reliably match the element even after page redesigns.${previousContext}

Respond with ONLY a JSON array:
[{"selector": "...", "type": "css"|"xpath"|"aria", "confidence": 0.0-1.0, "reasoning": "..."}]`;

  const user = `Description: "${description}"\n\nSimplified DOM:\n${truncated}`;

  const messages: AdapterMessage[] = [
    { role: "system", content: system },
    { role: "user", content: user },
  ];

  try {
    const result = await routeAndCollect({
      model: "auto",
      messages,
      temperature: 0.2,
      max_tokens: 2048,
    });

    const jsonMatch = result.text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return [];

    const parsed = JSON.parse(jsonMatch[0]);
    if (!Array.isArray(parsed)) return [];

    return parsed
      .filter((c: any) =>
        typeof c.selector === "string" &&
        typeof c.type === "string" &&
        typeof c.confidence === "number" &&
        ["css", "xpath", "aria"].includes(c.type)
      )
      .map((c: any) => ({
        selector: c.selector,
        type: c.type as "css" | "xpath" | "aria",
        confidence: Math.max(0, Math.min(1, c.confidence)),
        reasoning: c.reasoning || "",
      }))
      .sort((a: CandidateSelector, b: CandidateSelector) => b.confidence - a.confidence);
  } catch (err) {
    logger.error({ err }, "Self-healing selector resolution failed");
    return [];
  }
}

/* ── Helpers ───────────────────────────────────────────────────────── */

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
