export interface HierarchicalChunk {
  content: string;
  parentContent: string | null;
  level: "parent" | "child";
}

/**
 * Chunk text into flat chunks (original behavior).
 */
export function chunkText(text: string, chunkSize: number = 512, overlap: number = 64): string[] {
  if (!text || text.trim().length === 0) return [];
  // Validate chunk parameters to prevent infinite loops or division by zero
  if (!Number.isFinite(chunkSize) || chunkSize < 1) chunkSize = 512;
  if (!Number.isFinite(overlap) || overlap < 0) overlap = 0;
  if (overlap >= chunkSize) overlap = Math.floor(chunkSize / 4);

  // Split by paragraphs first
  const paragraphs = text.split(/\n\s*\n/).filter((p) => p.trim().length > 0);
  const MAX_CHUNKS = 10_000;
  const chunks: string[] = [];

  let buffer = "";

  for (const para of paragraphs) {
    if (chunks.length >= MAX_CHUNKS) break;
    if (buffer.length + para.length + 1 <= chunkSize) {
      buffer += (buffer ? "\n\n" : "") + para;
    } else {
      if (buffer) chunks.push(buffer.trim());

      if (para.length <= chunkSize) {
        buffer = para;
      } else {
        // Split long paragraph by sentences
        // Cap sentences per paragraph to prevent pathological regex results
        const sentences = (para.match(/[^.!?]+[.!?]+\s*/g) || [para]).slice(0, 500);
        buffer = "";

        for (const sentence of sentences) {
          if (buffer.length + sentence.length <= chunkSize) {
            buffer += sentence;
          } else {
            if (buffer) chunks.push(buffer.trim());

            if (sentence.length > chunkSize) {
              // Hard split with overlap
              for (let i = 0; i < sentence.length; i += chunkSize - overlap) {
                chunks.push(sentence.slice(i, i + chunkSize).trim());
              }
              buffer = "";
            } else {
              buffer = sentence;
            }
          }
        }
      }
    }
  }

  if (buffer.trim()) chunks.push(buffer.trim());
  return chunks;
}

/**
 * Parent-child chunking: produces large parent chunks (1536 chars) and
 * smaller child chunks (512 chars) within each parent. When a child chunk
 * matches a query, the parent context can be injected for better comprehension.
 *
 * Returns flat array of HierarchicalChunk with parent references.
 */
export function chunkHierarchical(
  text: string,
  parentSize: number = 1536,
  childSize: number = 512,
  childOverlap: number = 64,
): HierarchicalChunk[] {
  if (!text || text.trim().length === 0) return [];

  // Step 1: Create parent chunks (large)
  const parentChunks = chunkText(text, parentSize, 128);

  const result: HierarchicalChunk[] = [];

  for (const parentContent of parentChunks) {
    // Step 2: Split each parent into child chunks
    const children = chunkText(parentContent, childSize, childOverlap);

    if (children.length <= 1) {
      // Parent is small enough to be its own chunk — no hierarchy needed
      result.push({
        content: parentContent,
        parentContent: null,
        level: "parent",
      });
    } else {
      // Store each child with a reference to its parent
      for (const childContent of children) {
        result.push({
          content: childContent,
          parentContent,
          level: "child",
        });
      }
    }
  }

  return result;
}

// ── Chunk Merging ─────────────────────────────────────────────────────────────

export interface MergedChunk {
  content: string;
  sourceIndices: number[];
  mergedFrom: number;
}

/**
 * Merge adjacent chunks from the same document into coherent sections.
 *
 * Onyx-inspired: after initial chunking, adjacent small chunks that fit
 * within maxMergedSize are stitched back together. This produces more
 * coherent retrieval units while respecting section boundaries.
 *
 * Merging stops when:
 * - Combined size exceeds maxMergedSize
 * - A section break marker is detected between chunks
 * - Maximum merge count is reached
 */
export function mergeAdjacentChunks(
  chunks: string[],
  maxMergedSize: number = 1024,
  maxMergeCount: number = 4,
  sectionBreakPattern: RegExp = /^(?:#{1,6}\s|={3,}|_{3,}|-{3,}|Chapter\s+\d|Section\s+\d|PART\s+[IVX\d])/im,
): MergedChunk[] {
  if (chunks.length === 0) return [];

  const result: MergedChunk[] = [];
  let currentContent = chunks[0];
  let currentIndices = [0];

  for (let i = 1; i < chunks.length; i++) {
    const nextChunk = chunks[i];
    const combined = currentContent + "\n\n" + nextChunk;
    const wouldExceedSize = combined.length > maxMergedSize;
    const wouldExceedCount = currentIndices.length >= maxMergeCount;
    const hasSectionBreak = sectionBreakPattern.test(nextChunk);

    if (wouldExceedSize || wouldExceedCount || hasSectionBreak) {
      // Flush current merged chunk
      result.push({
        content: currentContent,
        sourceIndices: [...currentIndices],
        mergedFrom: currentIndices.length,
      });
      currentContent = nextChunk;
      currentIndices = [i];
    } else {
      currentContent = combined;
      currentIndices.push(i);
    }
  }

  // Flush remaining
  result.push({
    content: currentContent,
    sourceIndices: [...currentIndices],
    mergedFrom: currentIndices.length,
  });

  return result;
}

// ── Content Enrichment ────────────────────────────────────────────────────────

export interface EnrichedChunk {
  content: string;
  /** Document title prepended for context */
  title: string | null;
  /** Section heading prepended for context */
  sectionHeading: string | null;
  /** Keywords extracted from the chunk */
  keywords: string[];
  /** Original chunk index */
  originalIndex: number;
}

/**
 * Enrich chunks with document-level and section-level context.
 *
 * Onyx-inspired: post-chunking enrichment adds document title, section
 * headings, and extracted keywords to each chunk. This improves retrieval
 * by giving the embedding model more context about what each chunk is about.
 */
export function enrichChunks(
  chunks: string[],
  opts: {
    documentTitle?: string;
    headings?: Map<number, string>;
    keywordExtractor?: (text: string) => string[];
  } = {},
): EnrichedChunk[] {
  const { documentTitle, headings, keywordExtractor } = opts;
  let currentHeading: string | null = null;

  return chunks.map((content, i) => {
    // Track section headings from the headings map or detect inline
    if (headings?.has(i)) {
      currentHeading = headings.get(i) ?? null;
    } else {
      const headingMatch = content.match(/^(#{1,6})\s+(.+)$/m);
      if (headingMatch) {
        currentHeading = headingMatch[2];
      }
    }

    // Extract keywords if extractor provided, otherwise use simple extraction
    const keywords = keywordExtractor
      ? keywordExtractor(content)
      : extractSimpleKeywords(content);

    // Build enriched content: prepend title + heading for better embeddings
    const parts: string[] = [];
    if (documentTitle) parts.push(`Document: ${documentTitle}`);
    if (currentHeading) parts.push(`Section: ${currentHeading}`);
    parts.push(content);

    return {
      content: parts.join("\n"),
      title: documentTitle ?? null,
      sectionHeading: currentHeading,
      keywords,
      originalIndex: i,
    };
  });
}

/**
 * Simple keyword extraction — pulls capitalized terms, quoted phrases,
 * and technical identifiers from chunk text.
 */
function extractSimpleKeywords(text: string, maxKeywords: number = 10): string[] {
  const keywords = new Set<string>();

  // Quoted phrases
  const quoted = text.match(/"([^"]{2,30})"/g);
  if (quoted) {
    for (const q of quoted.slice(0, 5)) {
      keywords.add(q.replace(/"/g, ""));
    }
  }

  // Capitalized multi-word terms (e.g. "Knowledge Graph", "API Gateway")
  const capitalized = text.match(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+\b/g);
  if (capitalized) {
    for (const c of capitalized.slice(0, 5)) {
      keywords.add(c);
    }
  }

  // Technical identifiers (camelCase, snake_case, kebab-case)
  const technical = text.match(/\b[a-z]+(?:[A-Z][a-z]+)+\b|\b[a-z]+(?:_[a-z]+){1,}\b|\b[a-z]+(?:-[a-z]+){2,}\b/g);
  if (technical) {
    for (const t of technical.slice(0, 5)) {
      keywords.add(t);
    }
  }

  // ALL-CAPS acronyms (2-6 chars)
  const acronyms = text.match(/\b[A-Z]{2,6}\b/g);
  if (acronyms) {
    for (const a of acronyms.slice(0, 5)) {
      keywords.add(a);
    }
  }

  return [...keywords].slice(0, maxKeywords);
}
