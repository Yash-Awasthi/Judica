import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Hoisted DB mock ──────────────────────────────────────────────────────────
const { mockDbInsert, mockInsertValues } = vi.hoisted(() => {
  const mockInsertReturning = vi.fn().mockResolvedValue([{ id: "artifact-uuid-1" }]);
  const mockInsertValues = vi.fn().mockReturnValue({ returning: mockInsertReturning });
  const mockDbInsert = vi.fn().mockReturnValue({ values: mockInsertValues });
  return { mockDbInsert, mockInsertValues };
});

vi.mock("../../src/lib/drizzle.js", () => ({ db: { insert: mockDbInsert } }));
vi.mock("../../src/db/schema/research.js", () => ({ artifacts: { id: "id" } }));
vi.mock("../../src/lib/logger.js", () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() })),
  },
}));

import { detectArtifact, saveArtifact } from "../../src/services/artifacts.service.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Build a fenced code block with `n` lines of content. */
function codeBlock(lang: string, lines: number): string {
  const body = Array.from({ length: lines }, (_, i) => `  line${i + 1}();`).join("\n");
  return `\`\`\`${lang}\n${body}\n\`\`\``;
}

/** Build a markdown document guaranteed to be 500+ chars with `headers` headings. */
function markdownDoc(headers: number, totalLength = 600): string {
  const headings = Array.from({ length: headers }, (_, i) => `# Section ${i + 1}\n`).join("");
  const padding = "x".repeat(Math.max(0, totalLength - headings.length));
  return headings + padding;
}

// ─── detectArtifact ───────────────────────────────────────────────────────────

describe("detectArtifact", () => {
  // Code block tests
  describe("code blocks", () => {
    it("returns type=code for a code block with 20+ lines", () => {
      const result = detectArtifact(codeBlock("ts", 20));
      expect(result).not.toBeNull();
      expect(result!.type).toBe("code");
    });

    it("maps 'ts' to 'typescript'", () => {
      const result = detectArtifact(codeBlock("ts", 20));
      expect(result!.language).toBe("typescript");
    });

    it("maps 'py' to 'python'", () => {
      const result = detectArtifact(codeBlock("py", 20));
      expect(result!.language).toBe("python");
    });

    it("maps 'js' to 'javascript'", () => {
      const result = detectArtifact(codeBlock("js", 20));
      expect(result!.language).toBe("javascript");
    });

    it("returns null for a code block with fewer than 20 lines", () => {
      const result = detectArtifact(codeBlock("ts", 10));
      expect(result).toBeNull();
    });

    it("returns null for a code block with exactly 19 lines", () => {
      const result = detectArtifact(codeBlock("python", 19));
      expect(result).toBeNull();
    });

    it("returns type=code for a code block with exactly 20 lines", () => {
      const result = detectArtifact(codeBlock("go", 20));
      expect(result!.type).toBe("code");
    });

    it("uses the raw lang string for an unknown language", () => {
      const result = detectArtifact(codeBlock("cobol", 20));
      expect(result!.language).toBe("cobol");
    });

    it("includes the code content (trimmed) in the result", () => {
      const response = codeBlock("ts", 20);
      const result = detectArtifact(response);
      expect(result!.content).toContain("line1()");
    });

    it("sets name to include the resolved language", () => {
      const result = detectArtifact(codeBlock("ts", 20));
      expect(result!.name).toBe("Code snippet (typescript)");
    });
  });

  // HTML tests
  describe("HTML documents", () => {
    it("detects <!DOCTYPE html> + </html> as type=html", () => {
      const html = "<!DOCTYPE html>\n<html>\n<head></head>\n<body></body>\n</html>";
      expect(detectArtifact(html)!.type).toBe("html");
    });

    it("sets name to 'HTML Document'", () => {
      const html = "<!DOCTYPE html>\n<html><body></body></html>";
      expect(detectArtifact(html)!.name).toBe("HTML Document");
    });

    it("detects <html ...> + </html> (no DOCTYPE) as type=html", () => {
      const html = "<html lang=\"en\"><head></head><body></body></html>";
      expect(detectArtifact(html)!.type).toBe("html");
    });

    it("returns null when </html> closing tag is absent", () => {
      const html = "<head><title>T</title></head><body><p>content</p></body>";
      expect(detectArtifact(html)).toBeNull();
    });
  });

  // JSON tests
  describe("JSON", () => {
    it("detects a valid JSON object longer than 100 chars as type=json", () => {
      const obj = JSON.stringify({ key: "value", data: "x".repeat(90) });
      expect(obj.length).toBeGreaterThan(100);
      expect(detectArtifact(obj)!.type).toBe("json");
    });

    it("detects a valid JSON array longer than 100 chars as type=json", () => {
      const arr = JSON.stringify(Array.from({ length: 10 }, (_, i) => ({ id: i, val: "abc" })));
      expect(arr.length).toBeGreaterThan(100);
      expect(detectArtifact(arr)!.type).toBe("json");
    });

    it("returns null for a valid JSON array that is 100 chars or fewer", () => {
      const arr = JSON.stringify([1, 2, 3]);
      expect(arr.length).toBeLessThanOrEqual(100);
      expect(detectArtifact(arr)).toBeNull();
    });

    it("returns null for an invalid JSON string", () => {
      const bad = "{not: valid json}";
      expect(detectArtifact(bad)).toBeNull();
    });

    it("returns null for a JSON string that starts with '{' but is not complete", () => {
      expect(detectArtifact("{incomplete")).toBeNull();
    });
  });

  // Markdown tests
  describe("structured markdown", () => {
    it("detects markdown with 2+ headers and 500+ chars as type=markdown", () => {
      const md = markdownDoc(2, 600);
      expect(detectArtifact(md)!.type).toBe("markdown");
    });

    it("returns null for markdown with only 1 header even if 500+ chars", () => {
      const md = markdownDoc(1, 600);
      expect(detectArtifact(md)).toBeNull();
    });

    it("returns null for markdown with 2+ headers but fewer than 500 chars", () => {
      // Two headings but total length < 500
      const md = "# A\n# B\n" + "x".repeat(10);
      expect(md.length).toBeLessThan(500);
      expect(detectArtifact(md)).toBeNull();
    });

    it("sets name to 'Document' for markdown artifacts", () => {
      const md = markdownDoc(3, 600);
      expect(detectArtifact(md)!.name).toBe("Document");
    });
  });

  // Edge cases
  describe("edge cases", () => {
    it("returns null for an empty string", () => {
      expect(detectArtifact("")).toBeNull();
    });

    it("returns null for plain prose with no artifact pattern", () => {
      expect(detectArtifact("Hello, this is just a normal response.")).toBeNull();
    });
  });
});

// ─── saveArtifact ─────────────────────────────────────────────────────────────

describe("saveArtifact", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset default return for each test
    const mockInsertReturning = vi.fn().mockResolvedValue([{ id: "artifact-uuid-1" }]);
    mockInsertValues.mockReturnValue({ returning: mockInsertReturning });
    mockDbInsert.mockReturnValue({ values: mockInsertValues });
  });

  it("calls db.insert with the correct fields", async () => {
    const artifact = { name: "Code snippet (typescript)", type: "code" as const, content: "const x = 1;", language: "typescript" };
    await saveArtifact(42, "conv-123", artifact);

    expect(mockDbInsert).toHaveBeenCalledOnce();
    expect(mockInsertValues).toHaveBeenCalledOnce();
    const insertedValues = mockInsertValues.mock.calls[0][0];
    expect(insertedValues.userId).toBe(42);
    expect(insertedValues.conversationId).toBe("conv-123");
    expect(insertedValues.type).toBe("code");
    expect(insertedValues.content).toBe("const x = 1;");
    expect(insertedValues.name).toBe("Code snippet (typescript)");
    expect(insertedValues.language).toBe("typescript");
    expect(typeof insertedValues.id).toBe("string");
  });

  it("returns the id from the inserted record", async () => {
    const artifact = { name: "JSON Data", type: "json" as const, content: '{"a":1}' };
    const id = await saveArtifact(1, null, artifact);
    expect(id).toBe("artifact-uuid-1");
  });

  it("truncates content over 500,000 chars", async () => {
    const longContent = "x".repeat(600_000);
    const artifact = { name: "Big doc", type: "markdown" as const, content: longContent };
    await saveArtifact(1, null, artifact);

    const insertedValues = mockInsertValues.mock.calls[0][0];
    expect(insertedValues.content.length).toBe(500_000);
  });

  it("truncates name over 500 chars", async () => {
    const longName = "N".repeat(600);
    const artifact = { name: longName, type: "code" as const, content: "x", language: "ts" };
    await saveArtifact(1, "conv-1", artifact);

    const insertedValues = mockInsertValues.mock.calls[0][0];
    expect(insertedValues.name.length).toBe(500);
  });

  it("stores null for language when artifact has no language", async () => {
    const artifact = { name: "HTML Document", type: "html" as const, content: "<html></html>" };
    await saveArtifact(1, null, artifact);

    const insertedValues = mockInsertValues.mock.calls[0][0];
    expect(insertedValues.language).toBeNull();
  });
});
