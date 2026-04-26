import { describe, it, expect, vi } from "vitest";

vi.mock("../../src/lib/logger.js", () => ({
  default: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("../../src/config/env.js", () => ({
  env: {
    DATABASE_URL: "postgresql://test:test@localhost:5432/test",
    JWT_SECRET: "test-jwt-secret-min-16-chars",
    MASTER_ENCRYPTION_KEY: "test-master-encryption-key-min-32-characters-long",
  },
}));

import { chunkText, mergeAdjacentChunks, enrichChunks } from "../../src/services/chunker.service.js";

// ── P11-87: Code block handling in chunker ───────────────────────────────────

describe("P11-87: Code block handling in chunker", () => {
  it("does not split a short code block across chunks when it fits within chunkSize", () => {
    const codeBlock = "```python\ndef hello():\n    print('hello')\n    return True\n```";
    const surroundingText = "Here is the code:\n\n" + codeBlock + "\n\nThat was the code.";

    const chunks = chunkText(surroundingText, 500, 20);

    const codeChunk = chunks.find((c) => c.includes("```python"));
    expect(codeChunk).toBeDefined();
    expect(codeChunk).toContain("def hello():");
    expect(codeChunk).toContain("return True");
  });

  it("documents that long code blocks may be split (known limitation)", () => {
    const longCode =
      "```javascript\n" +
      Array.from({ length: 30 }, (_, i) => `const line${i} = ${i};`).join("\n") +
      "\n```";

    const chunks = chunkText(longCode, 100, 10);
    expect(chunks.length).toBeGreaterThan(1);

    // First chunk must start with the opening fence
    expect(chunks[0]).toContain("```javascript");
  });

  it("handles multiple code blocks in a document — all content is preserved", () => {
    const doc =
      "# Setup\n\n```bash\nnpm install\n```\n\n" +
      "Some text between blocks.\n\n" +
      "# Usage\n\n```js\nimport { foo } from 'bar';\nfoo();\n```";

    const chunks = chunkText(doc, 500, 20);
    const fullText = chunks.join("\n\n");

    expect(fullText).toContain("npm install");
    expect(fullText).toContain("import { foo }");
  });
});

// ── P11-88: Chunk overlap — hard-split paths ──────────────────────────────────

describe("P11-88: Chunk overlap correctness", () => {
  it("hard-split chunks contain overlapping content at their boundaries", () => {
    // A single long sentence forces hard splitting with overlap
    const longSentence = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".repeat(10) + ". ";
    const chunkSize = 30;
    const overlap = 10;
    const result = chunkText(longSentence, chunkSize, overlap);

    expect(result.length).toBeGreaterThan(1);

    // The end of chunk[i] should equal the start of chunk[i+1] by exactly `overlap` chars
    // (only valid when both chunks are fully within the repeated alphabet string)
    for (let i = 0; i < result.length - 1; i++) {
      if (result[i].length === chunkSize && result[i + 1].length >= overlap) {
        const tail = result[i].slice(-overlap);
        const head = result[i + 1].slice(0, overlap);
        expect(tail).toBe(head);
      }
    }
  });

  it("overlap=0 produces chunks with no duplicated characters (for uniform content)", () => {
    // All Ys so every step creates identical-looking content, but with step=chunkSize
    const longSentence = "Y".repeat(200) + ". ";
    const chunkSize = 30;
    const chunks = chunkText(longSentence, chunkSize, 0);

    expect(chunks.length).toBeGreaterThan(1);
    // Total characters across all chunks should not exceed original length
    // (no content is duplicated with zero overlap)
    const totalChars = chunks.join("").length;
    expect(totalChars).toBeLessThanOrEqual(longSentence.length);
  });

  it("each hard-split chunk is no longer than chunkSize", () => {
    const longSentence = "ABCDE".repeat(100) + ". ";
    const chunkSize = 25;
    const chunks = chunkText(longSentence, chunkSize, 5);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(chunkSize);
    }
  });

  it("overlap that equals chunkSize is auto-clamped to chunkSize/4", () => {
    // overlap >= chunkSize → clamped, so function still terminates
    const text = "Word. ".repeat(50);
    expect(() => chunkText(text, 50, 50)).not.toThrow();
    const chunks = chunkText(text, 50, 50);
    expect(chunks.length).toBeGreaterThan(0);
  });
});

// ── P11-89: mergeAdjacentChunks — section boundary detection ─────────────────

describe("P11-89: Section break detection in mergeAdjacentChunks", () => {
  it("does not merge across a ### level-3 heading", () => {
    const chunks = ["preamble content here", "### Sub-section\ndetails follow"];
    const result = mergeAdjacentChunks(chunks, 10000);
    // Section break must start a new merged chunk
    expect(result.length).toBeGreaterThanOrEqual(2);
    expect(result[0].content).toBe("preamble content here");
    expect(result[1].content).toContain("### Sub-section");
  });

  it("does not merge across a 'Section N' header", () => {
    const chunks = ["before text", "Section 2\nNew chapter content"];
    const result = mergeAdjacentChunks(chunks, 10000);
    expect(result.length).toBeGreaterThanOrEqual(2);
    expect(result[1].content).toContain("Section 2");
  });

  it("does not merge across a 'PART I' header", () => {
    const chunks = ["intro", "PART I\nThe beginning"];
    const result = mergeAdjacentChunks(chunks, 10000);
    expect(result.length).toBeGreaterThanOrEqual(2);
    expect(result[1].content).toContain("PART I");
  });

  it("does merge adjacent chunks that contain no section breaks", () => {
    const chunks = ["plain text", "more plain text", "even more text"];
    const result = mergeAdjacentChunks(chunks, 10000);
    expect(result).toHaveLength(1);
    expect(result[0].mergedFrom).toBe(3);
  });

  it("correctly tracks sourceIndices across multiple flushes", () => {
    // Force a flush at every chunk via maxMergeCount=1 (each chunk stays alone)
    const chunks = ["x", "y", "z", "w"];
    const result = mergeAdjacentChunks(chunks, 10000, 1);
    expect(result).toHaveLength(4);
    result.forEach((r, i) => {
      expect(r.sourceIndices).toEqual([i]);
      expect(r.mergedFrom).toBe(1);
    });
  });
});

// ── P11-90: enrichChunks — heading propagation and keyword quality ────────────

describe("P11-90: enrichChunks heading propagation", () => {
  it("heading from map applies to the assigned index and all subsequent un-headed chunks", () => {
    const headings = new Map([[0, "Overview"]]);
    const result = enrichChunks(["c0", "c1", "c2"], { headings });

    expect(result[0].sectionHeading).toBe("Overview");
    expect(result[1].sectionHeading).toBe("Overview"); // inherited
    expect(result[2].sectionHeading).toBe("Overview"); // inherited
  });

  it("inline heading in a later chunk overrides the previously propagated heading", () => {
    const result = enrichChunks([
      "## Chapter One\nfirst content",
      "still chapter one",
      "## Chapter Two\nnew content",
      "chapter two content",
    ]);

    expect(result[0].sectionHeading).toBe("Chapter One");
    expect(result[1].sectionHeading).toBe("Chapter One");
    expect(result[2].sectionHeading).toBe("Chapter Two");
    expect(result[3].sectionHeading).toBe("Chapter Two");
  });

  it("headings map entry at a later index updates the running heading correctly", () => {
    const headings = new Map([
      [0, "Intro"],
      [2, "Deep Dive"],
    ]);
    const result = enrichChunks(["c0", "c1", "c2", "c3"], { headings });

    expect(result[0].sectionHeading).toBe("Intro");
    expect(result[1].sectionHeading).toBe("Intro"); // inherited
    expect(result[2].sectionHeading).toBe("Deep Dive");
    expect(result[3].sectionHeading).toBe("Deep Dive"); // inherited
  });

  it("content field equals just the original text when no title or heading is set", () => {
    const result = enrichChunks(["raw content"]);
    expect(result[0].content).toBe("raw content");
  });

  it("content field correctly joins title + heading + original with single newlines", () => {
    const headings = new Map([[0, "Intro"]]);
    const result = enrichChunks(["body"], { documentTitle: "Doc", headings });
    expect(result[0].content).toBe("Document: Doc\nSection: Intro\nbody");
  });
});

// ── P11-91: enrichChunks — keyword extraction quality ────────────────────────

describe("P11-91: Keyword extraction from enrichChunks", () => {
  it("extracts snake_case identifiers as keywords", () => {
    const result = enrichChunks(["call the fetch_user_data function"]);
    expect(result[0].keywords).toContain("fetch_user_data");
  });

  it("does not extract single-word capitalised terms (needs two+ capitalised words)", () => {
    const result = enrichChunks(["The word Database alone is not a multi-word term"]);
    // "Database" alone should not match the capitalized multi-word pattern
    expect(result[0].keywords).not.toContain("Database");
  });

  it("extracts multi-word capitalised terms correctly", () => {
    const result = enrichChunks(["Natural Language Processing is a field"]);
    expect(result[0].keywords).toContain("Natural Language Processing");
  });

  it("does not extract single-letter or very short acronyms (< 2 chars)", () => {
    const result = enrichChunks(["A B C are single letters"]);
    // 1-char acronyms should not be extracted (pattern requires 2-6 chars)
    expect(result[0].keywords).not.toContain("A");
    expect(result[0].keywords).not.toContain("B");
  });

  it("extracts 6-char acronym (upper bound of pattern)", () => {
    const result = enrichChunks(["ABCDEF is a valid acronym"]);
    expect(result[0].keywords).toContain("ABCDEF");
  });

  it("does not extract 7-char ALL-CAPS tokens (exceeds 6-char limit)", () => {
    const result = enrichChunks(["ABCDEFG is too long for an acronym"]);
    expect(result[0].keywords).not.toContain("ABCDEFG");
  });

  it("quoted phrases must be at least 2 chars to be extracted", () => {
    const result = enrichChunks(['"x" is a short quote that should not match']);
    // "x" is only 1 char — the regex requires {2,30} chars inside quotes
    expect(result[0].keywords).not.toContain("x");
  });

  it("total keywords never exceed 10 even with many matching patterns", () => {
    // Dense text with many different keyword types
    const text =
      '"alpha beta" "gamma delta" "epsilon zeta" "eta theta" "iota kappa" ' +
      "Foo Bar Baz Qux Quux API REST HTTP JWT RPC queryFoo updateBar buildCache";
    const result = enrichChunks([text]);
    expect(result[0].keywords.length).toBeLessThanOrEqual(10);
  });
});
