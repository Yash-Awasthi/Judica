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
  // P25-04: Validate chunk parameters to prevent infinite loops or division by zero
  if (!Number.isFinite(chunkSize) || chunkSize < 1) chunkSize = 512;
  if (!Number.isFinite(overlap) || overlap < 0) overlap = 0;
  if (overlap >= chunkSize) overlap = Math.floor(chunkSize / 4);

  // Split by paragraphs first
  const paragraphs = text.split(/\n\s*\n/).filter((p) => p.trim().length > 0);
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
        // P39-08: Cap sentences per paragraph to prevent pathological regex results
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
