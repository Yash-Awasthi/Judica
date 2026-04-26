/**
 * Extraction Engine — Phase 3.13
 *
 * Core engine for structured web data extraction using LLM.
 * Builds prompts from schema definitions, parses LLM output into typed fields,
 * validates extracted data, infers schemas from page content, merges multi-page
 * results, and converts output to various formats (JSON, CSV, table).
 *
 * Zero-dependency: LLM-based extraction via existing adapter infrastructure.
 */

import { routeAndCollect } from "../router/smartRouter.js";
import type { AdapterMessage } from "../adapters/types.js";
import logger from "./logger.js";

/* ── Types ─────────────────────────────────────────────────────────── */

export interface SchemaField {
  name: string;
  type: "string" | "number" | "boolean" | "date" | "url" | "email" | "array" | "object";
  required?: boolean;
  description?: string;
  /** Child fields for type: 'object' or 'array' (array of objects) */
  children?: SchemaField[];
}

export interface ExtractionSchema {
  fields: SchemaField[];
}

export interface ExtractedRow {
  [key: string]: unknown;
}

export interface ExtractionResult {
  rows: ExtractedRow[];
  totalRows: number;
  confidence: number;
  warnings: string[];
}

export interface ValidationError {
  field: string;
  message: string;
  row?: number;
}

export interface InferredSchema {
  fields: SchemaField[];
  confidence: number;
  suggestedName: string;
}

/* ── Prompt Building ───────────────────────────────────────────────── */

/**
 * Describe a SchemaField tree as a human-readable spec for the LLM prompt.
 */
function describeFields(fields: SchemaField[], indent = 0): string {
  const pad = "  ".repeat(indent);
  return fields
    .map((f) => {
      const req = f.required ? " (required)" : " (optional)";
      const desc = f.description ? ` — ${f.description}` : "";
      let line = `${pad}- "${f.name}": ${f.type}${req}${desc}`;
      if (f.children && f.children.length > 0) {
        line += "\n" + describeFields(f.children, indent + 1);
      }
      return line;
    })
    .join("\n");
}

/**
 * Build an LLM prompt that instructs the model to extract structured data
 * matching the provided schema from the given HTML content.
 */
export function buildExtractionPrompt(schema: ExtractionSchema, htmlContent: string): string {
  const fieldSpec = describeFields(schema.fields);

  // Truncate HTML to fit LLM context — keep first 120k chars
  const truncatedHtml = htmlContent.length > 120_000
    ? htmlContent.slice(0, 120_000) + "\n\n[... HTML truncated ...]"
    : htmlContent;

  return `You are a structured data extraction engine. Extract data from the provided HTML according to the schema below.

## Schema Definition

Extract the following fields for EACH item/row found on the page:

${fieldSpec}

## Rules

1. Return ONLY a valid JSON array of objects, one object per item/row found.
2. Each object must contain exactly the fields listed above.
3. For required fields, always provide a value (use null only as last resort).
4. For optional fields, include them if data is available, otherwise omit.
5. Coerce types: numbers should be actual numbers (not strings), booleans should be true/false, dates should be ISO 8601 strings.
6. For "url" type fields, return absolute URLs. Convert relative URLs to absolute if possible.
7. For "email" type fields, return valid email addresses only.
8. For "array" type fields, return a JSON array.
9. For "object" type fields with children, return a nested object with child fields.
10. If no items are found, return an empty array: []
11. Do NOT include any explanation, markdown fences, or text outside the JSON array.

## HTML Content

${truncatedHtml}

## Extracted JSON`;
}

/* ── LLM Output Parsing ────────────────────────────────────────────── */

/**
 * Parse the raw LLM output into typed rows matching the schema.
 * Handles common LLM output quirks: markdown fences, trailing text, etc.
 */
export function parseExtractionResult(llmOutput: string, schema: ExtractionSchema): ExtractionResult {
  const warnings: string[] = [];

  // Strip markdown code fences if present
  let cleaned = llmOutput.trim();
  if (cleaned.startsWith("```json")) {
    cleaned = cleaned.slice(7);
  } else if (cleaned.startsWith("```")) {
    cleaned = cleaned.slice(3);
  }
  if (cleaned.endsWith("```")) {
    cleaned = cleaned.slice(0, -3);
  }
  cleaned = cleaned.trim();

  // Find the JSON array bounds
  const startIdx = cleaned.indexOf("[");
  const endIdx = cleaned.lastIndexOf("]");
  if (startIdx === -1 || endIdx === -1 || endIdx <= startIdx) {
    logger.warn("Extraction engine: no JSON array found in LLM output");
    return { rows: [], totalRows: 0, confidence: 0, warnings: ["No JSON array found in LLM output"] };
  }

  const jsonStr = cleaned.slice(startIdx, endIdx + 1);

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonStr);
  } catch (e) {
    logger.warn("Extraction engine: failed to parse JSON from LLM output", { error: String(e) });
    return { rows: [], totalRows: 0, confidence: 0, warnings: [`JSON parse error: ${String(e)}`] };
  }

  if (!Array.isArray(parsed)) {
    warnings.push("LLM output was not an array; wrapping in array");
    parsed = [parsed];
  }

  const rows: ExtractedRow[] = [];
  for (const item of parsed as unknown[]) {
    if (typeof item !== "object" || item === null) {
      warnings.push("Skipping non-object item in array");
      continue;
    }
    const row = coerceRow(item as Record<string, unknown>, schema.fields, warnings);
    rows.push(row);
  }

  // Confidence heuristic: based on how many required fields are populated
  const requiredFields = schema.fields.filter((f) => f.required);
  let filledCount = 0;
  let totalChecks = 0;
  for (const row of rows) {
    for (const rf of requiredFields) {
      totalChecks++;
      if (row[rf.name] !== null && row[rf.name] !== undefined) filledCount++;
    }
  }
  const confidence = totalChecks > 0 ? filledCount / totalChecks : rows.length > 0 ? 0.5 : 0;

  return {
    rows,
    totalRows: rows.length,
    confidence: Math.round(confidence * 100) / 100,
    warnings,
  };
}

/**
 * Coerce a raw row object to match the schema types.
 */
function coerceRow(raw: Record<string, unknown>, fields: SchemaField[], warnings: string[]): ExtractedRow {
  const row: ExtractedRow = {};

  for (const field of fields) {
    const value = raw[field.name];

    if (value === undefined || value === null) {
      if (field.required) {
        warnings.push(`Required field "${field.name}" is missing`);
      }
      row[field.name] = null;
      continue;
    }

    row[field.name] = coerceValue(value, field, warnings);
  }

  return row;
}

function coerceValue(value: unknown, field: SchemaField, warnings: string[]): unknown {
  switch (field.type) {
    case "string":
    case "url":
    case "email":
    case "date":
      return String(value);

    case "number": {
      const num = Number(value);
      if (isNaN(num)) {
        // Try extracting number from string (e.g. "$19.99" → 19.99)
        const match = String(value).match(/-?[\d,.]+/);
        if (match) {
          const cleaned = match[0].replace(/,/g, "");
          const parsed = Number(cleaned);
          if (!isNaN(parsed)) return parsed;
        }
        warnings.push(`Field "${field.name}": could not coerce "${String(value)}" to number`);
        return null;
      }
      return num;
    }

    case "boolean":
      if (typeof value === "boolean") return value;
      if (typeof value === "string") {
        const lower = value.toLowerCase().trim();
        if (lower === "true" || lower === "yes" || lower === "1") return true;
        if (lower === "false" || lower === "no" || lower === "0") return false;
      }
      return Boolean(value);

    case "array":
      if (Array.isArray(value)) {
        if (field.children && field.children.length > 0) {
          return value.map((item) =>
            typeof item === "object" && item !== null
              ? coerceRow(item as Record<string, unknown>, field.children!, warnings)
              : item
          );
        }
        return value;
      }
      warnings.push(`Field "${field.name}": expected array, got ${typeof value}`);
      return [value];

    case "object":
      if (typeof value === "object" && value !== null && !Array.isArray(value)) {
        if (field.children && field.children.length > 0) {
          return coerceRow(value as Record<string, unknown>, field.children, warnings);
        }
        return value;
      }
      warnings.push(`Field "${field.name}": expected object, got ${typeof value}`);
      return null;

    default:
      return value;
  }
}

/* ── Schema Validation ─────────────────────────────────────────────── */

/**
 * Validate extracted data against the schema definition.
 * Returns an array of validation errors (empty = valid).
 */
export function validateAgainstSchema(data: ExtractedRow[], schema: ExtractionSchema): ValidationError[] {
  const errors: ValidationError[] = [];

  for (let i = 0; i < data.length; i++) {
    const row = data[i];
    for (const field of schema.fields) {
      const value = row[field.name];

      // Required check
      if (field.required && (value === null || value === undefined)) {
        errors.push({ field: field.name, message: "Required field is missing", row: i });
        continue;
      }

      if (value === null || value === undefined) continue;

      // Type checks
      switch (field.type) {
        case "number":
          if (typeof value !== "number") {
            errors.push({ field: field.name, message: `Expected number, got ${typeof value}`, row: i });
          }
          break;
        case "boolean":
          if (typeof value !== "boolean") {
            errors.push({ field: field.name, message: `Expected boolean, got ${typeof value}`, row: i });
          }
          break;
        case "url":
          if (typeof value !== "string" || !isValidUrl(value)) {
            errors.push({ field: field.name, message: "Invalid URL", row: i });
          }
          break;
        case "email":
          if (typeof value !== "string" || !isValidEmail(value)) {
            errors.push({ field: field.name, message: "Invalid email", row: i });
          }
          break;
        case "date":
          if (typeof value !== "string" || isNaN(Date.parse(value))) {
            errors.push({ field: field.name, message: "Invalid date format", row: i });
          }
          break;
        case "array":
          if (!Array.isArray(value)) {
            errors.push({ field: field.name, message: "Expected array", row: i });
          }
          break;
        case "object":
          if (typeof value !== "object" || Array.isArray(value)) {
            errors.push({ field: field.name, message: "Expected object", row: i });
          }
          break;
        // string: any value is acceptable
      }
    }
  }

  return errors;
}

function isValidUrl(s: string): boolean {
  try {
    new URL(s);
    return true;
  } catch {
    return false;
  }
}

function isValidEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

/* ── Schema Inference ──────────────────────────────────────────────── */

/**
 * Auto-suggest a schema from page content by asking the LLM to analyze
 * the page structure and propose extraction fields.
 */
export async function inferSchemaFromUrl(url: string, html: string): Promise<InferredSchema> {
  const truncatedHtml = html.length > 80_000
    ? html.slice(0, 80_000) + "\n\n[... HTML truncated ...]"
    : html;

  const messages: AdapterMessage[] = [
    {
      role: "user",
      content: `Analyze the following HTML page and suggest a structured extraction schema.

URL: ${url}

Identify the main repeating data items on the page (e.g., product listings, job postings, articles, table rows) and define a schema to extract them.

Return ONLY valid JSON in this exact format:
{
  "suggestedName": "short descriptive name for the schema",
  "confidence": 0.85,
  "fields": [
    {
      "name": "field_name",
      "type": "string|number|boolean|date|url|email|array|object",
      "required": true,
      "description": "what this field captures"
    }
  ]
}

Supported types: string, number, boolean, date, url, email, array, object.
Only return the JSON object, no explanation.

HTML Content:
${truncatedHtml}`,
    },
  ];

  const chunks: string[] = [];
  for await (const chunk of routeAndCollect(messages, {
    systemMessage: "You are a schema inference engine. Analyze HTML pages and return structured field definitions.",
    temperature: 0.2,
  })) {
    if (typeof chunk === "string") chunks.push(chunk);
  }

  const raw = chunks.join("");
  let cleaned = raw.trim();
  if (cleaned.startsWith("```json")) cleaned = cleaned.slice(7);
  else if (cleaned.startsWith("```")) cleaned = cleaned.slice(3);
  if (cleaned.endsWith("```")) cleaned = cleaned.slice(0, -3);
  cleaned = cleaned.trim();

  try {
    const parsed = JSON.parse(cleaned);
    return {
      suggestedName: parsed.suggestedName ?? "Untitled Schema",
      confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0.5,
      fields: Array.isArray(parsed.fields) ? parsed.fields : [],
    };
  } catch (e) {
    logger.warn("Schema inference: failed to parse LLM output", { error: String(e) });
    return { suggestedName: "Untitled Schema", confidence: 0, fields: [] };
  }
}

/* ── Multi-Page Merge ──────────────────────────────────────────────── */

/**
 * Merge results from multiple page extractions into a single result set.
 * Deduplicates rows by comparing stringified content.
 */
export function mergePageResults(results: ExtractionResult[]): ExtractionResult {
  const allRows: ExtractedRow[] = [];
  const allWarnings: string[] = [];
  const seen = new Set<string>();

  for (const result of results) {
    for (const row of result.rows) {
      const key = JSON.stringify(row);
      if (!seen.has(key)) {
        seen.add(key);
        allRows.push(row);
      }
    }
    allWarnings.push(...result.warnings);
  }

  const avgConfidence = results.length > 0
    ? results.reduce((sum, r) => sum + r.confidence, 0) / results.length
    : 0;

  return {
    rows: allRows,
    totalRows: allRows.length,
    confidence: Math.round(avgConfidence * 100) / 100,
    warnings: allWarnings,
  };
}

/* ── Format Conversion ─────────────────────────────────────────────── */

/**
 * Convert extracted rows to the requested output format.
 */
export function convertToFormat(
  data: ExtractedRow[],
  format: "json" | "csv" | "table",
  fields?: SchemaField[],
): string {
  if (data.length === 0) {
    return format === "json" ? "[]" : "";
  }

  switch (format) {
    case "json":
      return JSON.stringify(data, null, 2);

    case "csv": {
      const columns = fields
        ? fields.map((f) => f.name)
        : Object.keys(data[0]);
      const header = columns.map(escapeCsvCell).join(",");
      const rows = data.map((row) =>
        columns.map((col) => escapeCsvCell(String(row[col] ?? ""))).join(",")
      );
      return [header, ...rows].join("\n");
    }

    case "table": {
      const columns = fields
        ? fields.map((f) => f.name)
        : Object.keys(data[0]);
      // Calculate column widths
      const widths = columns.map((col) => {
        const values = data.map((row) => String(row[col] ?? "").slice(0, 40));
        return Math.max(col.length, ...values.map((v) => v.length));
      });
      const divider = widths.map((w) => "-".repeat(w + 2)).join("+");
      const headerRow = columns.map((col, i) => ` ${col.padEnd(widths[i])} `).join("|");
      const dataRows = data.map((row) =>
        columns.map((col, i) => ` ${String(row[col] ?? "").slice(0, 40).padEnd(widths[i])} `).join("|")
      );
      return [headerRow, divider, ...dataRows].join("\n");
    }

    default:
      return JSON.stringify(data, null, 2);
  }
}

function escapeCsvCell(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/* ── Built-in Templates ────────────────────────────────────────────── */

export const BUILTIN_TEMPLATES = [
  {
    name: "Product Listings",
    description: "Extract product data from e-commerce pages — name, price, image, rating, availability",
    category: "ecommerce",
    schema: {
      fields: [
        { name: "name", type: "string", required: true, description: "Product name/title" },
        { name: "price", type: "number", required: true, description: "Product price (numeric)" },
        { name: "currency", type: "string", required: false, description: "Price currency (USD, EUR, etc.)" },
        { name: "image_url", type: "url", required: false, description: "Main product image URL" },
        { name: "product_url", type: "url", required: false, description: "Link to product detail page" },
        { name: "rating", type: "number", required: false, description: "Average rating (e.g. 4.5)" },
        { name: "review_count", type: "number", required: false, description: "Number of reviews" },
        { name: "in_stock", type: "boolean", required: false, description: "Whether the product is available" },
        { name: "description", type: "string", required: false, description: "Short product description" },
      ],
    },
    sampleUrls: [
      "https://www.amazon.com/s?k=wireless+headphones",
      "https://www.ebay.com/sch/i.html?_nkw=laptop",
    ],
  },
  {
    name: "Job Postings",
    description: "Extract job listing data — title, company, location, salary, requirements",
    category: "jobs",
    schema: {
      fields: [
        { name: "title", type: "string", required: true, description: "Job title" },
        { name: "company", type: "string", required: true, description: "Hiring company name" },
        { name: "location", type: "string", required: false, description: "Job location" },
        { name: "salary_min", type: "number", required: false, description: "Minimum salary" },
        { name: "salary_max", type: "number", required: false, description: "Maximum salary" },
        { name: "job_type", type: "string", required: false, description: "Full-time, Part-time, Contract, etc." },
        { name: "remote", type: "boolean", required: false, description: "Whether remote work is allowed" },
        { name: "posted_date", type: "date", required: false, description: "When the job was posted" },
        { name: "job_url", type: "url", required: false, description: "Link to full job posting" },
        { name: "description", type: "string", required: false, description: "Short job description" },
      ],
    },
    sampleUrls: [
      "https://www.indeed.com/jobs?q=software+engineer",
      "https://www.linkedin.com/jobs/search/?keywords=developer",
    ],
  },
  {
    name: "News Articles",
    description: "Extract article data from news sites — headline, author, date, summary, link",
    category: "news",
    schema: {
      fields: [
        { name: "headline", type: "string", required: true, description: "Article headline/title" },
        { name: "author", type: "string", required: false, description: "Article author" },
        { name: "published_date", type: "date", required: false, description: "Publication date" },
        { name: "summary", type: "string", required: false, description: "Article summary or first paragraph" },
        { name: "article_url", type: "url", required: false, description: "Link to full article" },
        { name: "image_url", type: "url", required: false, description: "Article thumbnail image" },
        { name: "category", type: "string", required: false, description: "Article section/category" },
        { name: "source", type: "string", required: false, description: "Publication/source name" },
      ],
    },
    sampleUrls: [
      "https://news.ycombinator.com",
      "https://www.reuters.com",
    ],
  },
  {
    name: "Contact Information",
    description: "Extract contact details — name, email, phone, company, role",
    category: "contacts",
    schema: {
      fields: [
        { name: "name", type: "string", required: true, description: "Person or business name" },
        { name: "email", type: "email", required: false, description: "Email address" },
        { name: "phone", type: "string", required: false, description: "Phone number" },
        { name: "company", type: "string", required: false, description: "Company/organization" },
        { name: "role", type: "string", required: false, description: "Job title or role" },
        { name: "address", type: "string", required: false, description: "Physical address" },
        { name: "website", type: "url", required: false, description: "Personal or company website" },
      ],
    },
    sampleUrls: [
      "https://example.com/team",
      "https://example.com/contact",
    ],
  },
  {
    name: "Pricing Tables",
    description: "Extract pricing/plan information — plan name, price, features, billing period",
    category: "pricing",
    schema: {
      fields: [
        { name: "plan_name", type: "string", required: true, description: "Name of the pricing plan" },
        { name: "price", type: "number", required: true, description: "Plan price (numeric)" },
        { name: "currency", type: "string", required: false, description: "Price currency" },
        { name: "billing_period", type: "string", required: false, description: "Monthly, yearly, etc." },
        { name: "features", type: "array", required: false, description: "List of included features" },
        { name: "is_popular", type: "boolean", required: false, description: "Whether this is the highlighted/recommended plan" },
        { name: "cta_text", type: "string", required: false, description: "Call-to-action button text" },
        { name: "cta_url", type: "url", required: false, description: "Call-to-action link" },
      ],
    },
    sampleUrls: [
      "https://github.com/pricing",
      "https://www.notion.so/pricing",
    ],
  },
];
