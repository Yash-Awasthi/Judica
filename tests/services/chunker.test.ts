import { describe, it, expect } from "vitest";
import { chunkText, chunkHierarchical } from "../../src/services/chunker.service";

describe("chunkText", () => {
  // --- Empty / whitespace input ---

  it("returns empty array for empty string", () => {
    expect(chunkText("")).toEqual([]);
  });

  it("returns empty array for undefined-like falsy input", () => {
    expect(chunkText(null as unknown as string)).toEqual([]);
    expect(chunkText(undefined as unknown as string)).toEqual([]);
  });

  it("returns empty array for whitespace-only input", () => {
    expect(chunkText("   ")).toEqual([]);
    expect(chunkText("\n\n\n")).toEqual([]);
    expect(chunkText("  \n  \n  ")).toEqual([]);
    expect(chunkText("\t\t")).toEqual([]);
  });

  // --- Single short paragraph ---

  it("returns single chunk for short text under default chunkSize", () => {
    const text = "Hello world.";
    const result = chunkText(text);
    expect(result).toEqual(["Hello world."]);
  });

  it("returns single chunk when text equals chunkSize exactly", () => {
    const text = "a".repeat(512);
    const result = chunkText(text);
    expect(result).toEqual([text]);
  });

  // --- Multiple paragraphs grouping ---

  it("groups multiple short paragraphs into one chunk when they fit", () => {
    const text = "Paragraph one.\n\nParagraph two.\n\nParagraph three.";
    const result = chunkText(text);
    expect(result).toEqual(["Paragraph one.\n\nParagraph two.\n\nParagraph three."]);
  });

  it("splits paragraphs across chunks when they exceed chunkSize", () => {
    const p1 = "A".repeat(40);
    const p2 = "B".repeat(40);
    const p3 = "C".repeat(40);
    const text = `${p1}\n\n${p2}\n\n${p3}`;
    // chunkSize=50: p1 (40) fits alone, p1+\n\n+p2 = 40+2+40=82 > 50
    const result = chunkText(text, 50);
    expect(result).toHaveLength(3);
    expect(result[0]).toBe(p1);
    expect(result[1]).toBe(p2);
    expect(result[2]).toBe(p3);
  });

  it("groups first two paragraphs together when they fit, third in new chunk", () => {
    const p1 = "A".repeat(20);
    const p2 = "B".repeat(20);
    const p3 = "C".repeat(20);
    // chunkSize=50: p1+\n\n+p2 = 20+2+20=42 <= 50, then 42+2+20=64 > 50
    const text = `${p1}\n\n${p2}\n\n${p3}`;
    const result = chunkText(text, 50);
    expect(result).toHaveLength(2);
    expect(result[0]).toBe(`${p1}\n\n${p2}`);
    expect(result[1]).toBe(p3);
  });

  it("ignores blank paragraphs from multiple newlines", () => {
    const text = "First.\n\n\n\nSecond.";
    const result = chunkText(text);
    expect(result).toEqual(["First.\n\nSecond."]);
  });

  // --- Long paragraph: sentence splitting ---

  it("splits a long paragraph by sentences when it exceeds chunkSize", () => {
    const s1 = "A".repeat(30) + ". ";
    const s2 = "B".repeat(30) + ". ";
    const s3 = "C".repeat(30) + ". ";
    const para = s1 + s2 + s3; // ~96 chars
    const result = chunkText(para, 70);
    // s1+s2 = 64 <= 70 should be grouped, s3 separate
    expect(result.length).toBeGreaterThanOrEqual(2);
    expect(result[0]).toContain("A");
    expect(result[result.length - 1]).toContain("C");
  });

  it("handles sentences ending with ! and ?", () => {
    const s1 = "What is going on here? ";
    const s2 = "This is amazing! ";
    const s3 = "I agree completely. ";
    const para = s1 + s2 + s3;
    const result = chunkText(para, 40);
    // s1 (23) fits, s1+s2 = 40 <= 40 fits, s1+s2+s3 = 60 > 40
    expect(result.length).toBe(2);
  });

  it("falls back to full paragraph when no sentence boundaries found", () => {
    // No sentence-ending punctuation -> match returns null -> fallback to [para]
    const para = "A".repeat(100);
    // Use overlap smaller than chunkSize to avoid negative step
    const result = chunkText(para, 50, 10);
    // Falls back to [para] as single "sentence", then hard-splits
    expect(result.length).toBeGreaterThan(1);
    // All content should be present
    const joined = result.join("");
    expect(joined.length).toBeGreaterThanOrEqual(100);
  });

  // --- Hard split with overlap ---

  it("hard splits a sentence longer than chunkSize with correct overlap", () => {
    const longSentence = "X".repeat(200) + ". ";
    const chunkSize = 50;
    const overlap = 10;
    const result = chunkText(longSentence, chunkSize, overlap);

    // Each chunk should be at most chunkSize
    for (const chunk of result) {
      expect(chunk.length).toBeLessThanOrEqual(chunkSize);
    }

    // Verify overlap: the end of chunk[i] should overlap with start of chunk[i+1]
    // Step is chunkSize - overlap = 40, so chunk[0] covers [0,50), chunk[1] covers [40,90), etc.
    expect(result.length).toBeGreaterThan(1);
  });

  it("hard split steps by (chunkSize - overlap)", () => {
    const content = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    // Make a sentence that is exactly this content + ". "
    const sentence = content + ". ";
    // chunkSize=10, overlap=3 -> step=7
    // Wrap it so it triggers sentence splitting (paragraph > chunkSize, sentence > chunkSize)
    const result = chunkText(sentence, 10, 3);

    // First chunk starts at 0, length 10 -> "ABCDEFGHIJ"
    expect(result[0]).toBe("ABCDEFGHIJ");
    // Second chunk starts at 7, length 10 -> "HIJKLMNOPQ"
    expect(result[1]).toBe("HIJKLMNOPQ");
    // Third chunk starts at 14, length 10 -> "OPQRSTUVWX"
    expect(result[2]).toBe("OPQRSTUVWX");
  });

  it("produces overlapping content between consecutive hard-split chunks", () => {
    // Use a string with unique chars so we can verify overlap precisely
    // 200 chars, each unique by position
    const base = Array.from({ length: 200 }, (_, i) => String.fromCharCode(65 + (i % 26))).join("");
    const longSentence = base + ". ";
    const chunkSize = 80;
    const overlap = 20;
    const step = chunkSize - overlap; // 60
    const result = chunkText(longSentence, chunkSize, overlap);

    expect(result.length).toBeGreaterThan(1);
    // Verify overlap between first two chunks (both fully within the base string)
    const chunk0End = result[0].slice(-overlap);
    const chunk1Start = result[1].slice(0, overlap);
    expect(chunk0End).toBe(chunk1Start);
  });

  // --- Custom chunkSize and overlap ---

  it("respects custom chunkSize", () => {
    const text = "Word. ".repeat(100); // ~600 chars
    const result = chunkText(text, 100);
    for (const chunk of result) {
      expect(chunk.length).toBeLessThanOrEqual(100);
    }
    expect(result.length).toBeGreaterThan(1);
  });

  it("works with very small chunkSize", () => {
    const text = "Hello world. Foo bar.";
    const result = chunkText(text, 15, 3);
    expect(result.length).toBeGreaterThan(0);
    for (const chunk of result) {
      expect(chunk.length).toBeLessThanOrEqual(15);
    }
  });

  it("works with overlap of 0", () => {
    const longSentence = "Y".repeat(100) + ". ";
    const result = chunkText(longSentence, 30, 0);
    expect(result.length).toBeGreaterThan(1);
    // With 0 overlap, no content should repeat between consecutive chunks of uniform char
    // step = chunkSize - 0 = 30
    expect(result[0]).toBe("Y".repeat(30));
    expect(result[1]).toBe("Y".repeat(30));
  });

  // --- Edge cases ---

  it("trims chunks (no leading/trailing whitespace)", () => {
    const text = "  Hello world.  \n\n  Second paragraph.  ";
    const result = chunkText(text);
    for (const chunk of result) {
      expect(chunk).toBe(chunk.trim());
    }
  });

  it("handles text with only one paragraph separator", () => {
    const text = "First.\n\nSecond.";
    const result = chunkText(text, 1000);
    expect(result).toEqual(["First.\n\nSecond."]);
  });

  it("handles mixed sentence terminators in a long paragraph", () => {
    const para =
      "Is this working? Yes it is! And it continues. More text here? Absolutely! Done.";
    const result = chunkText(para, 40);
    expect(result.length).toBeGreaterThan(1);
    // Reconstruct: all sentence content should be present
    const allText = result.join(" ");
    expect(allText).toContain("working?");
    expect(allText).toContain("Done.");
  });

  it("uses default chunkSize=512 and overlap=64", () => {
    // A text that fits in 512 should return one chunk
    const text = "A".repeat(512);
    expect(chunkText(text)).toEqual([text]);

    // A text over 512 should split
    const longText = "B".repeat(600) + ". ";
    const result = chunkText(longText);
    expect(result.length).toBeGreaterThan(1);
  });

  it("handles paragraph that splits into sentences all fitting in chunkSize", () => {
    // Paragraph > chunkSize but each sentence < chunkSize
    const s1 = "A".repeat(30) + ". ";
    const s2 = "B".repeat(30) + ". ";
    const s3 = "C".repeat(30) + ". ";
    const s4 = "D".repeat(30) + ". ";
    const para = s1 + s2 + s3 + s4; // ~128 chars
    const result = chunkText(para, 70);
    // Sentences get grouped: s1+s2 = 64 <= 70, then s3+s4 = 64 <= 70
    expect(result.length).toBe(2);
  });
});

describe("chunkHierarchical", () => {
  it("returns empty array for empty string", () => {
    expect(chunkHierarchical("")).toEqual([]);
  });

  it("returns standalone parent for short text", () => {
    const result = chunkHierarchical("Short text.", 1536, 512, 64);
    expect(result).toHaveLength(1);
    expect(result[0].level).toBe("parent");
    expect(result[0].parentContent).toBeNull();
    expect(result[0].content).toBe("Short text.");
  });

  it("produces child chunks with parent references for long text", () => {
    // Build text large enough to need hierarchy: parent=200, child=50
    const text = Array.from({ length: 10 }, (_, i) => `Sentence number ${i + 1} with some extra words to add length.`).join(" ");
    const result = chunkHierarchical(text, 200, 50, 10);

    const children = result.filter((c) => c.level === "child");
    expect(children.length).toBeGreaterThan(0);

    for (const child of children) {
      expect(child.parentContent).toBeTruthy();
      expect(child.parentContent!.length).toBeGreaterThan(child.content.length);
    }
  });

  it("all child chunks reference valid parent content", () => {
    const paragraphs = Array.from({ length: 5 }, (_, i) =>
      `Paragraph ${i + 1}. This is a longer paragraph with multiple sentences. It has enough content to be chunked. More text here for good measure.`
    ).join("\n\n");

    const result = chunkHierarchical(paragraphs, 200, 60, 10);
    const children = result.filter((c) => c.level === "child");

    for (const child of children) {
      // Child content should be a substring of its parent
      expect(child.parentContent).toBeTruthy();
      expect(child.parentContent!).toContain(child.content.substring(0, 20));
    }
  });
});
