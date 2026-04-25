/**
 * Named Entity Recognition for indexed documents.
 * Extracts entities (people, orgs, locations, dates, topics, products, technology)
 * from document chunks.
 *
 * Strategy:
 *  1. If NER_ENABLED=true and LLM is reachable, use LLM-based extraction.
 *  2. Otherwise fall back to lightweight regex patterns.
 *
 * Rate-limiting: batch processing with configurable delay between LLM calls
 * to avoid API overload.
 */

import { routeAndCollect } from "../router/index.js";
import logger from "../lib/logger.js";

export type EntityType =
  | "PERSON"
  | "ORG"
  | "LOCATION"
  | "DATE"
  | "PRODUCT"
  | "TOPIC"
  | "TECHNOLOGY";

export interface ExtractedEntity {
  text: string;
  type: EntityType;
  confidence: number;
  startChar?: number;
  endChar?: number;
}

// ─── Regex-based fallback patterns ───────────────────────────────────────────

/** Common tech keywords for TECHNOLOGY entity detection */
const TECH_KEYWORDS = new Set([
  "javascript", "typescript", "python", "java", "golang", "rust", "kotlin",
  "swift", "php", "ruby", "c++", "c#", "scala", "react", "angular", "vue",
  "node", "nodejs", "deno", "bun", "nextjs", "nuxt", "express", "fastify",
  "django", "flask", "rails", "spring", "docker", "kubernetes", "k8s",
  "terraform", "ansible", "jenkins", "github", "gitlab", "bitbucket",
  "aws", "azure", "gcp", "postgresql", "mysql", "mongodb", "redis",
  "elasticsearch", "kafka", "rabbitmq", "graphql", "rest", "grpc",
  "openai", "anthropic", "langchain", "llm", "gpt", "claude", "llama",
  "machine learning", "deep learning", "neural network", "nlp", "ai",
  "linux", "ubuntu", "debian", "windows", "macos", "ios", "android",
  "git", "npm", "yarn", "pnpm", "webpack", "vite", "esbuild",
  "api", "sdk", "oauth", "jwt", "ssl", "tls", "https", "websocket",
  "microservices", "serverless", "devops", "cicd", "agile", "scrum",
]);

/** Patterns for org entities — company suffixes */
const ORG_SUFFIX_PATTERN = /\b([A-Z][A-Za-z0-9&.'.-]+(?: [A-Z][A-Za-z0-9&.'.-]+)*)\s+(?:Inc\.?|LLC\.?|Corp\.?|Ltd\.?|Limited|Co\.?|GmbH|S\.A\.|PLC|LP|LLP|Foundation|Institute|University|College|Association|Organization|Agency)\b/g;

/** Two-or-more capitalized words for PERSON detection */
const PERSON_PATTERN = /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3})\b/g;

/** Date patterns */
const DATE_PATTERN = /\b(?:\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}|\d{4}[-/.]\d{1,2}[-/.]\d{1,2}|(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}(?:st|nd|rd|th)?,?\s+\d{4}|\d{1,2}(?:st|nd|rd|th)?\s+(?:January|February|March|April|May|June|July|August|September|October|November|December),?\s+\d{4}|Q[1-4]\s+\d{4}|\d{4})\b/g;

/** Common location indicators */
const LOCATION_PATTERN = /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\s*,\s*(?:[A-Z]{2}|[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\b/g;

/** Title prefixes that strongly indicate PERSON */
const TITLE_PERSON_PATTERN = /\b(?:Mr\.?|Mrs\.?|Ms\.?|Dr\.?|Prof\.?|Sir|Dame|Lord|Lady|CEO|CTO|CFO|COO|VP|President|Director|Manager|Engineer)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})\b/g;

/**
 * Regex-based entity extraction (no LLM required).
 * Lower accuracy but zero API cost.
 */
function extractEntitiesRegex(text: string): ExtractedEntity[] {
  const entities: ExtractedEntity[] = [];
  const seen = new Set<string>();

  function addEntity(e: ExtractedEntity) {
    const key = `${e.type}:${e.text.toLowerCase()}`;
    if (!seen.has(key)) {
      seen.add(key);
      entities.push(e);
    }
  }

  // ── ORG ──────────────────────────────────────────────────────────
  let match: RegExpExecArray | null;
  const orgRe = new RegExp(ORG_SUFFIX_PATTERN.source, "g");
  while ((match = orgRe.exec(text)) !== null) {
    addEntity({
      text: match[0].trim(),
      type: "ORG",
      confidence: 0.8,
      startChar: match.index,
      endChar: match.index + match[0].length,
    });
  }

  // ── PERSON (title-prefixed — higher confidence) ───────────────────
  const titleRe = new RegExp(TITLE_PERSON_PATTERN.source, "g");
  while ((match = titleRe.exec(text)) !== null) {
    addEntity({
      text: match[0].trim(),
      type: "PERSON",
      confidence: 0.85,
      startChar: match.index,
      endChar: match.index + match[0].length,
    });
  }

  // ── PERSON (capitalized name pairs — lower confidence) ────────────
  const personRe = new RegExp(PERSON_PATTERN.source, "g");
  while ((match = personRe.exec(text)) !== null) {
    const candidate = match[1];
    // Skip if it's already in ORG entities, common English words, or single tokens
    const lc = candidate.toLowerCase();
    if (
      !seen.has(`ORG:${lc}`) &&
      !["The", "This", "That", "These", "Those", "In", "On", "At", "By"].includes(candidate.split(" ")[0])
    ) {
      addEntity({
        text: candidate,
        type: "PERSON",
        confidence: 0.55,
        startChar: match.index,
        endChar: match.index + candidate.length,
      });
    }
  }

  // ── DATE ─────────────────────────────────────────────────────────
  const dateRe = new RegExp(DATE_PATTERN.source, "g");
  while ((match = dateRe.exec(text)) !== null) {
    addEntity({
      text: match[0].trim(),
      type: "DATE",
      confidence: 0.9,
      startChar: match.index,
      endChar: match.index + match[0].length,
    });
  }

  // ── LOCATION ─────────────────────────────────────────────────────
  const locRe = new RegExp(LOCATION_PATTERN.source, "g");
  while ((match = locRe.exec(text)) !== null) {
    const candidate = match[0].trim();
    if (!seen.has(`ORG:${candidate.toLowerCase()}`)) {
      addEntity({
        text: candidate,
        type: "LOCATION",
        confidence: 0.75,
        startChar: match.index,
        endChar: match.index + candidate.length,
      });
    }
  }

  // ── TECHNOLOGY ───────────────────────────────────────────────────
  const lowerText = text.toLowerCase();
  for (const keyword of TECH_KEYWORDS) {
    const idx = lowerText.indexOf(keyword);
    if (idx !== -1) {
      // Check word boundaries
      const before = idx === 0 ? " " : lowerText[idx - 1];
      const after = idx + keyword.length >= lowerText.length ? " " : lowerText[idx + keyword.length];
      if (/\W/.test(before) && /\W/.test(after)) {
        addEntity({
          text: text.slice(idx, idx + keyword.length),
          type: "TECHNOLOGY",
          confidence: 0.85,
          startChar: idx,
          endChar: idx + keyword.length,
        });
      }
    }
  }

  return entities;
}

// ─── LLM-based extraction ─────────────────────────────────────────────────────

const NER_PROMPT_SYSTEM = `You are a named entity recognition (NER) system. Extract named entities from the provided text.

Return ONLY a valid JSON array — no explanation, no markdown code blocks, no extra text.

Each element must be an object with:
  "text": the exact entity string as it appears in the text
  "type": one of PERSON | ORG | LOCATION | DATE | PRODUCT | TOPIC | TECHNOLOGY
  "confidence": a float between 0 and 1 indicating your confidence

Rules:
- PERSON: real people's names (not fictional characters unless clearly intended)
- ORG: companies, organizations, institutions
- LOCATION: cities, countries, regions, addresses
- DATE: specific dates, time periods, years, quarters
- PRODUCT: named products or services (software products, hardware, brands)
- TECHNOLOGY: programming languages, frameworks, tools, protocols, platforms
- TOPIC: key subject matters, concepts, or themes central to the text

Be precise. Omit duplicates. If no entities found, return an empty array [].`;

async function extractEntitiesLLM(text: string): Promise<ExtractedEntity[]> {
  // Truncate very long chunks to avoid token limits
  const truncated = text.length > 2000 ? text.slice(0, 2000) : text;

  const result = await routeAndCollect({
    model: "auto",
    messages: [
      { role: "system", content: NER_PROMPT_SYSTEM },
      { role: "user", content: `Extract named entities from this text:\n\n${truncated}` },
    ],
    temperature: 0,
    max_tokens: 1024,
  });

  // Strip any accidental markdown code block wrapping
  let raw = result.text.trim();
  if (raw.startsWith("```")) {
    raw = raw.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "").trim();
  }

  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) return [];

  return (parsed as Array<Record<string, unknown>>).map((item) => ({
    text: String(item.text ?? ""),
    type: (item.type as EntityType) ?? "TOPIC",
    confidence: typeof item.confidence === "number" ? item.confidence : 0.7,
    startChar: typeof item.startChar === "number" ? item.startChar : undefined,
    endChar: typeof item.endChar === "number" ? item.endChar : undefined,
  })).filter((e) => e.text.length > 0);
}

// ─── Public API ───────────────────────────────────────────────────────────────

const NER_ENABLED = process.env.NER_ENABLED === "true";
const NER_BATCH_DELAY_MS = parseInt(process.env.NER_BATCH_DELAY_MS ?? "300", 10);

/**
 * Extract named entities from a single text chunk.
 *
 * Uses LLM-based extraction when NER_ENABLED=true and the LLM router is available.
 * Falls back to regex patterns on any error or when NER_ENABLED=false.
 */
export async function extractEntities(text: string): Promise<ExtractedEntity[]> {
  if (!text || text.trim().length === 0) return [];

  if (NER_ENABLED) {
    try {
      return await extractEntitiesLLM(text);
    } catch (err) {
      logger.warn({ err: (err as Error).message }, "NER: LLM extraction failed, falling back to regex");
    }
  }

  return extractEntitiesRegex(text);
}

/**
 * Extract entities from multiple chunks with rate-limiting.
 *
 * Processes chunks sequentially with a configurable delay between each LLM call
 * to prevent API overload. If NER_ENABLED=false, all chunks are processed via
 * the fast regex fallback without delay.
 */
export async function extractEntitiesBatch(chunks: string[]): Promise<ExtractedEntity[][]> {
  if (chunks.length === 0) return [];

  if (!NER_ENABLED) {
    // Regex fallback is synchronous — process all at once
    return chunks.map(extractEntitiesRegex);
  }

  const results: ExtractedEntity[][] = [];

  for (let i = 0; i < chunks.length; i++) {
    try {
      results.push(await extractEntitiesLLM(chunks[i]));
    } catch (err) {
      logger.warn({ err: (err as Error).message, chunkIndex: i }, "NER: LLM failed for chunk, using regex fallback");
      results.push(extractEntitiesRegex(chunks[i]));
    }

    // Rate-limit: pause between chunks when using LLM
    if (i < chunks.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, NER_BATCH_DELAY_MS));
    }
  }

  return results;
}
