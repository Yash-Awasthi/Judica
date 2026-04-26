import { describe, it, expect } from "vitest";
import {
  buildExtractionPrompt,
  parseExtractionResult,
  validateAgainstSchema,
  mergePageResults,
  convertToFormat,
  type SchemaField,
  type ExtractionSchema,
  type ExtractionResult,
  type ExtractedRow,
} from "../../src/lib/extractionEngine.js";

/* ── buildExtractionPrompt ─────────────────────────────────────────── */

describe("buildExtractionPrompt", () => {
  it("should include field names and types in prompt", () => {
    const schema: ExtractionSchema = {
      fields: [
        { name: "title", type: "string", required: true, description: "Product title" },
        { name: "price", type: "number", required: true, description: "Price in USD" },
      ],
    };
    const prompt = buildExtractionPrompt(schema, "<html><body>Hello</body></html>");

    expect(prompt).toContain('"title"');
    expect(prompt).toContain('"price"');
    expect(prompt).toContain("string");
    expect(prompt).toContain("number");
    expect(prompt).toContain("(required)");
    expect(prompt).toContain("Product title");
    expect(prompt).toContain("<html>");
  });

  it("should truncate very long HTML", () => {
    const schema: ExtractionSchema = { fields: [{ name: "x", type: "string" }] };
    const longHtml = "a".repeat(200_000);
    const prompt = buildExtractionPrompt(schema, longHtml);

    expect(prompt).toContain("[... HTML truncated ...]");
    expect(prompt.length).toBeLessThan(200_000);
  });

  it("should handle nested fields", () => {
    const schema: ExtractionSchema = {
      fields: [
        {
          name: "author",
          type: "object",
          children: [
            { name: "name", type: "string", required: true },
            { name: "email", type: "email" },
          ],
        },
      ],
    };
    const prompt = buildExtractionPrompt(schema, "<html></html>");
    expect(prompt).toContain('"author"');
    expect(prompt).toContain('"name"');
    expect(prompt).toContain('"email"');
  });
});

/* ── parseExtractionResult ─────────────────────────────────────────── */

describe("parseExtractionResult", () => {
  const schema: ExtractionSchema = {
    fields: [
      { name: "title", type: "string", required: true },
      { name: "price", type: "number", required: true },
      { name: "inStock", type: "boolean" },
    ],
  };

  it("should parse valid JSON array", () => {
    const llmOutput = '[{"title": "Widget", "price": 19.99, "inStock": true}]';
    const result = parseExtractionResult(llmOutput, schema);

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].title).toBe("Widget");
    expect(result.rows[0].price).toBe(19.99);
    expect(result.rows[0].inStock).toBe(true);
    expect(result.totalRows).toBe(1);
    expect(result.confidence).toBeGreaterThan(0);
  });

  it("should handle markdown code fences", () => {
    const llmOutput = '```json\n[{"title": "Widget", "price": 9.99}]\n```';
    const result = parseExtractionResult(llmOutput, schema);

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].title).toBe("Widget");
  });

  it("should coerce string numbers to numbers", () => {
    const llmOutput = '[{"title": "Thing", "price": "24.50"}]';
    const result = parseExtractionResult(llmOutput, schema);

    expect(result.rows[0].price).toBe(24.5);
  });

  it("should extract numbers from price strings", () => {
    const llmOutput = '[{"title": "Thing", "price": "$19.99"}]';
    const result = parseExtractionResult(llmOutput, schema);

    expect(result.rows[0].price).toBe(19.99);
  });

  it("should handle missing required fields with warning", () => {
    const llmOutput = '[{"price": 10}]';
    const result = parseExtractionResult(llmOutput, schema);

    expect(result.rows[0].title).toBeNull();
    expect(result.warnings.some((w) => w.includes("title"))).toBe(true);
  });

  it("should return empty result for invalid output", () => {
    const result = parseExtractionResult("I could not find any data", schema);

    expect(result.rows).toHaveLength(0);
    expect(result.confidence).toBe(0);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it("should handle boolean coercion from strings", () => {
    const llmOutput = '[{"title": "A", "price": 1, "inStock": "yes"}]';
    const result = parseExtractionResult(llmOutput, schema);

    expect(result.rows[0].inStock).toBe(true);
  });

  it("should handle multiple rows", () => {
    const llmOutput = '[{"title": "A", "price": 1}, {"title": "B", "price": 2}, {"title": "C", "price": 3}]';
    const result = parseExtractionResult(llmOutput, schema);

    expect(result.rows).toHaveLength(3);
    expect(result.totalRows).toBe(3);
  });

  it("should handle empty JSON array", () => {
    const result = parseExtractionResult("[]", schema);
    expect(result.rows).toHaveLength(0);
    expect(result.totalRows).toBe(0);
  });
});

/* ── validateAgainstSchema ─────────────────────────────────────────── */

describe("validateAgainstSchema", () => {
  const schema: ExtractionSchema = {
    fields: [
      { name: "title", type: "string", required: true },
      { name: "price", type: "number", required: true },
      { name: "link", type: "url" },
      { name: "email", type: "email" },
      { name: "tags", type: "array" },
      { name: "active", type: "boolean" },
    ],
  };

  it("should return no errors for valid data", () => {
    const data: ExtractedRow[] = [
      {
        title: "Widget",
        price: 19.99,
        link: "https://example.com",
        email: "test@example.com",
        tags: ["a", "b"],
        active: true,
      },
    ];
    const errors = validateAgainstSchema(data, schema);
    expect(errors).toHaveLength(0);
  });

  it("should detect missing required fields", () => {
    const data: ExtractedRow[] = [{ title: null, price: null }];
    const errors = validateAgainstSchema(data, schema);

    expect(errors.some((e) => e.field === "title")).toBe(true);
    expect(errors.some((e) => e.field === "price")).toBe(true);
  });

  it("should detect wrong types", () => {
    const data: ExtractedRow[] = [{ title: "OK", price: "not a number" }];
    const errors = validateAgainstSchema(data, schema);

    expect(errors.some((e) => e.field === "price")).toBe(true);
  });

  it("should detect invalid URLs", () => {
    const data: ExtractedRow[] = [{ title: "OK", price: 1, link: "not-a-url" }];
    const errors = validateAgainstSchema(data, schema);

    expect(errors.some((e) => e.field === "link")).toBe(true);
  });

  it("should detect invalid emails", () => {
    const data: ExtractedRow[] = [{ title: "OK", price: 1, email: "notanemail" }];
    const errors = validateAgainstSchema(data, schema);

    expect(errors.some((e) => e.field === "email")).toBe(true);
  });

  it("should include row index in errors", () => {
    const data: ExtractedRow[] = [
      { title: "OK", price: 1 },
      { title: null, price: 2 },
    ];
    const errors = validateAgainstSchema(data, schema);
    const titleError = errors.find((e) => e.field === "title");
    expect(titleError?.row).toBe(1);
  });
});

/* ── mergePageResults ──────────────────────────────────────────────── */

describe("mergePageResults", () => {
  it("should merge rows from multiple pages", () => {
    const results: ExtractionResult[] = [
      { rows: [{ title: "A" }], totalRows: 1, confidence: 0.9, warnings: [] },
      { rows: [{ title: "B" }], totalRows: 1, confidence: 0.8, warnings: [] },
    ];
    const merged = mergePageResults(results);

    expect(merged.rows).toHaveLength(2);
    expect(merged.totalRows).toBe(2);
    expect(merged.confidence).toBe(0.85);
  });

  it("should deduplicate identical rows", () => {
    const results: ExtractionResult[] = [
      { rows: [{ title: "A" }], totalRows: 1, confidence: 1, warnings: [] },
      { rows: [{ title: "A" }], totalRows: 1, confidence: 1, warnings: [] },
    ];
    const merged = mergePageResults(results);

    expect(merged.rows).toHaveLength(1);
  });

  it("should combine warnings", () => {
    const results: ExtractionResult[] = [
      { rows: [], totalRows: 0, confidence: 0, warnings: ["warn1"] },
      { rows: [], totalRows: 0, confidence: 0, warnings: ["warn2"] },
    ];
    const merged = mergePageResults(results);

    expect(merged.warnings).toEqual(["warn1", "warn2"]);
  });

  it("should handle empty results array", () => {
    const merged = mergePageResults([]);
    expect(merged.rows).toHaveLength(0);
    expect(merged.confidence).toBe(0);
  });
});

/* ── convertToFormat ───────────────────────────────────────────────── */

describe("convertToFormat", () => {
  const data: ExtractedRow[] = [
    { title: "Widget A", price: 19.99 },
    { title: "Widget B", price: 29.99 },
  ];

  it("should convert to JSON", () => {
    const json = convertToFormat(data, "json");
    const parsed = JSON.parse(json);
    expect(parsed).toHaveLength(2);
    expect(parsed[0].title).toBe("Widget A");
  });

  it("should convert to CSV", () => {
    const csv = convertToFormat(data, "csv");
    const lines = csv.split("\n");
    expect(lines[0]).toBe("title,price");
    expect(lines[1]).toBe("Widget A,19.99");
    expect(lines[2]).toBe("Widget B,29.99");
  });

  it("should escape CSV values with commas", () => {
    const dataWithComma: ExtractedRow[] = [{ title: "Widget, A", price: 10 }];
    const csv = convertToFormat(dataWithComma, "csv");
    expect(csv).toContain('"Widget, A"');
  });

  it("should convert to table", () => {
    const table = convertToFormat(data, "table");
    expect(table).toContain("title");
    expect(table).toContain("price");
    expect(table).toContain("Widget A");
    expect(table).toContain("---");
  });

  it("should return empty for no data", () => {
    expect(convertToFormat([], "json")).toBe("[]");
    expect(convertToFormat([], "csv")).toBe("");
    expect(convertToFormat([], "table")).toBe("");
  });

  it("should use field order from schema fields if provided", () => {
    const fields: SchemaField[] = [
      { name: "price", type: "number" },
      { name: "title", type: "string" },
    ];
    const csv = convertToFormat(data, "csv", fields);
    const firstLine = csv.split("\n")[0];
    expect(firstLine).toBe("price,title");
  });
});
