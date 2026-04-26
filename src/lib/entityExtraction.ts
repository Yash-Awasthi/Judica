/**
 * Entity Extraction — Phase 2.3
 *
 * Extracts named entities from text using regex heuristics.
 * In production, replace HTTP adapter with GLiNER or spaCy service.
 *
 * Inspired by:
 * - spaCy (MIT, explosion/spaCy) — industrial NLP with NER pipeline
 * - GLiNER (MIT, urchade/gliner) — generalist model for NER
 *
 * Entity types: PERSON, ORG, PRODUCT, TECH, DATE, LOCATION
 *
 * Configuration:
 * - ENTITY_EXTRACTION_URL — HTTP endpoint for a spaCy/GLiNER service (optional)
 *   POST { text: string } → { entities: Array<{ text, label, start, end }> }
 * - Falls back to regex-based heuristics if service not available
 */

const ENTITY_SERVICE_URL = process.env.ENTITY_EXTRACTION_URL;

export type EntityType = "PERSON" | "ORG" | "PRODUCT" | "TECH" | "DATE" | "LOCATION" | "OTHER";

export interface Entity {
  text: string;
  label: EntityType;
  start: number;
  end: number;
  confidence: number;
}

/** Regex-based heuristic entity patterns */
const HEURISTIC_PATTERNS: Array<{ regex: RegExp; label: EntityType; confidence: number }> = [
  { regex: /\b(?:OpenAI|Anthropic|Google|Microsoft|Apple|Meta|Amazon|AWS|Azure|GCP)\b/g, label: "ORG", confidence: 0.9 },
  { regex: /\b(?:GPT-?[34](?:\.\d)?|Claude|Gemini|Llama|Mistral|Grok)\b/gi, label: "PRODUCT", confidence: 0.9 },
  { regex: /\b(?:Python|JavaScript|TypeScript|Rust|Go|Java|C\+\+|PostgreSQL|Redis|Docker|Kubernetes)\b/g, label: "TECH", confidence: 0.85 },
  { regex: /\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}(?:,?\s+\d{4})?\b/g, label: "DATE", confidence: 0.8 },
  { regex: /\b\d{4}-\d{2}-\d{2}\b/g, label: "DATE", confidence: 0.95 },
  { regex: /\b(?:New York|San Francisco|London|Tokyo|Paris|Berlin|Beijing|Mumbai)\b/g, label: "LOCATION", confidence: 0.85 },
];

function heuristicExtract(text: string): Entity[] {
  const entities: Entity[] = [];
  for (const { regex, label, confidence } of HEURISTIC_PATTERNS) {
    let match;
    while ((match = regex.exec(text)) !== null) {
      entities.push({
        text: match[0],
        label,
        start: match.index,
        end: match.index + match[0].length,
        confidence,
      });
    }
    regex.lastIndex = 0;
  }
  // Deduplicate by text+label
  const seen = new Set<string>();
  return entities.filter(e => {
    const key = `${e.text.toLowerCase()}:${e.label}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function serviceExtract(text: string): Promise<Entity[]> {
  const res = await fetch(`${ENTITY_SERVICE_URL}/extract`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: text.slice(0, 5000) }),
  });
  if (!res.ok) throw new Error(`Entity service error: ${res.status}`);
  const data = await res.json() as { entities: Entity[] };
  return data.entities ?? [];
}

/**
 * Extract entities from text.
 * Uses external service if ENTITY_EXTRACTION_URL is set, otherwise heuristics.
 */
export async function extractEntities(text: string): Promise<Entity[]> {
  if (ENTITY_SERVICE_URL) {
    try {
      return await serviceExtract(text);
    } catch {
      // Fall through to heuristics
    }
  }
  return heuristicExtract(text);
}

/**
 * Extract entity triples from entities found in text.
 * Creates subject="user" predicate="mentioned" object=entity.text triples.
 */
export function entitiesToTriples(
  entities: Entity[],
  contextSubject = "user",
): Array<{ subject: string; predicate: string; object: string; confidence: number }> {
  return entities.map(e => ({
    subject: contextSubject,
    predicate: `mentioned ${e.label.toLowerCase()}`,
    object: e.text,
    confidence: e.confidence,
  }));
}
