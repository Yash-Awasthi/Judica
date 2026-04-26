/**
 * Structured Web Data Extraction — Phase 3.13
 *
 * Define the exact schema of data you want from a URL (fields, types, nesting).
 * The extraction layer navigates the page and returns clean structured output —
 * not raw HTML to parse yourself. Works on authenticated pages, infinite scroll,
 * dynamically generated content.
 *
 * Inspired by:
 * - AgentQL (agentql.com) — structured web data extraction
 * - Playwright scraping — authenticated + dynamic page handling
 * - JSON Schema — typed field definitions for structured output
 *
 * Zero-dependency: LLM-based extraction via existing adapter infrastructure.
 */

import { pgTable, serial, integer, text, boolean, timestamp, jsonb, index } from "drizzle-orm/pg-core";

/* ── Extraction Schemas ─────────────────────────────────────────────── */

/**
 * User-defined extraction schemas — field definitions that describe what
 * structured data to pull from a page.
 */
export const extractionSchemas = pgTable("extraction_schemas", {
  id:           serial("id").primaryKey(),
  userId:       integer("user_id").notNull(),
  name:         text("name").notNull(),
  description:  text("description"),
  /** JSON field definitions: SchemaField[] */
  schema:       jsonb("schema").notNull(),
  /** Output format preference */
  outputFormat: text("output_format").notNull().default("json"),
  /** Whether this schema is publicly visible */
  isPublic:     boolean("is_public").notNull().default(false),
  /** Schema version — incremented on each update */
  version:      integer("version").notNull().default(1),
  createdAt:    timestamp("created_at").defaultNow().notNull(),
  updatedAt:    timestamp("updated_at").defaultNow().notNull(),
}, (t) => ({
  userIdx: index("idx_extraction_schemas_user_id").on(t.userId),
}));

/* ── Extraction Jobs ────────────────────────────────────────────────── */

/**
 * Individual extraction runs against a URL using a schema.
 */
export const extractionJobs = pgTable("extraction_jobs", {
  id:               serial("id").primaryKey(),
  schemaId:         integer("schema_id").notNull(),
  userId:           integer("user_id").notNull(),
  url:              text("url").notNull(),
  status:           text("status").notNull().default("pending"),
  /** Extracted structured data */
  result:           jsonb("result"),
  extractedRows:    integer("extracted_rows").notNull().default(0),
  pagesProcessed:   integer("pages_processed").notNull().default(0),
  executionTimeMs:  integer("execution_time_ms"),
  errorMessage:     text("error_message"),
  /** Auth config for authenticated pages: { type, credentials } */
  authConfig:       jsonb("auth_config"),
  /** Pagination config: { type, selector, maxPages } */
  paginationConfig: jsonb("pagination_config"),
  createdAt:        timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  schemaIdx: index("idx_extraction_jobs_schema_id").on(t.schemaId),
  userIdx:   index("idx_extraction_jobs_user_id").on(t.userId),
  statusIdx: index("idx_extraction_jobs_status").on(t.status),
}));

/* ── Extraction Templates ───────────────────────────────────────────── */

/**
 * Built-in extraction templates for common use cases (product listings,
 * job postings, news articles, etc.).
 */
export const extractionTemplates = pgTable("extraction_templates", {
  id:          serial("id").primaryKey(),
  name:        text("name").notNull(),
  description: text("description"),
  category:    text("category").notNull(),
  /** JSON field definitions: SchemaField[] */
  schema:      jsonb("schema").notNull(),
  /** Example URLs this template works well on */
  sampleUrls:  jsonb("sample_urls"),
  createdAt:   timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  categoryIdx: index("idx_extraction_templates_category").on(t.category),
}));
