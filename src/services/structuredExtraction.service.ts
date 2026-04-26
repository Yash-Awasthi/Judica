/**
 * Structured Extraction Service — Phase 3.13
 *
 * CRUD for extraction schemas, job execution, pagination/auth handling,
 * template gallery, preview, and export.
 *
 * Uses the extraction engine (lib/extractionEngine.ts) for LLM-based extraction
 * and the existing web scraping infrastructure for page fetching.
 */

import { db } from "../lib/drizzle.js";
import {
  extractionSchemas,
  extractionJobs,
  extractionTemplates,
} from "../db/schema/structuredExtraction.js";
import { eq, and, desc } from "drizzle-orm";
import { validateSafeUrl } from "../lib/ssrf.js";
import { buildStealthHeaders } from "../lib/stealthBrowser.js";
import logger from "../lib/logger.js";
import {
  buildExtractionPrompt,
  parseExtractionResult,
  validateAgainstSchema,
  inferSchemaFromUrl,
  mergePageResults,
  convertToFormat,
  BUILTIN_TEMPLATES,
  type SchemaField,
  type ExtractionSchema,
  type ExtractionResult,
  type ExtractedRow,
} from "../lib/extractionEngine.js";
import { routeAndCollect } from "../router/smartRouter.js";
import type { AdapterMessage } from "../adapters/types.js";

/* ── Types ─────────────────────────────────────────────────────────── */

export interface CreateSchemaInput {
  name: string;
  description?: string;
  schema: { fields: SchemaField[] };
  outputFormat?: "json" | "csv" | "table";
  isPublic?: boolean;
}

export interface UpdateSchemaInput {
  name?: string;
  description?: string;
  schema?: { fields: SchemaField[] };
  outputFormat?: "json" | "csv" | "table";
  isPublic?: boolean;
}

export interface RunExtractionOpts {
  authConfig?: { type: string; credentials: Record<string, string> } | null;
  paginationConfig?: { type: string; selector?: string; maxPages?: number } | null;
}

export interface ExportFormat {
  format: "json" | "csv" | "table";
}

/* ── Schema CRUD ───────────────────────────────────────────────────── */

export async function createSchema(userId: number, input: CreateSchemaInput) {
  const [schema] = await db
    .insert(extractionSchemas)
    .values({
      userId,
      name: input.name,
      description: input.description ?? null,
      schema: input.schema,
      outputFormat: input.outputFormat ?? "json",
      isPublic: input.isPublic ?? false,
    })
    .returning();

  return schema;
}

export async function getSchemas(userId: number) {
  return db
    .select()
    .from(extractionSchemas)
    .where(eq(extractionSchemas.userId, userId))
    .orderBy(desc(extractionSchemas.createdAt));
}

export async function getSchemaById(id: number, userId: number) {
  const [schema] = await db
    .select()
    .from(extractionSchemas)
    .where(and(eq(extractionSchemas.id, id), eq(extractionSchemas.userId, userId)))
    .limit(1);

  return schema ?? null;
}

export async function updateSchema(id: number, userId: number, input: UpdateSchemaInput) {
  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (input.name !== undefined) updates.name = input.name;
  if (input.description !== undefined) updates.description = input.description;
  if (input.schema !== undefined) updates.schema = input.schema;
  if (input.outputFormat !== undefined) updates.outputFormat = input.outputFormat;
  if (input.isPublic !== undefined) updates.isPublic = input.isPublic;

  // Increment version on schema field change
  if (input.schema !== undefined) {
    const current = await getSchemaById(id, userId);
    if (current) {
      updates.version = (current.version ?? 1) + 1;
    }
  }

  const [updated] = await db
    .update(extractionSchemas)
    .set(updates)
    .where(and(eq(extractionSchemas.id, id), eq(extractionSchemas.userId, userId)))
    .returning();

  return updated ?? null;
}

export async function deleteSchema(id: number, userId: number) {
  // Delete associated jobs first
  const jobs = await db
    .select({ id: extractionJobs.id })
    .from(extractionJobs)
    .where(eq(extractionJobs.schemaId, id));

  if (jobs.length > 0) {
    await db
      .delete(extractionJobs)
      .where(eq(extractionJobs.schemaId, id));
  }

  const [deleted] = await db
    .delete(extractionSchemas)
    .where(and(eq(extractionSchemas.id, id), eq(extractionSchemas.userId, userId)))
    .returning();

  return deleted ?? null;
}

/* ── Extraction Execution ──────────────────────────────────────────── */

/**
 * Run a full extraction job: fetch page(s), extract data with LLM, store results.
 */
export async function runExtraction(
  schemaId: number,
  url: string,
  userId: number,
  opts: RunExtractionOpts = {},
) {
  // Look up the schema
  const schema = await getSchemaById(schemaId, userId);
  if (!schema) throw new Error("Extraction schema not found");

  validateSafeUrl(url);

  // Create the job record
  const [job] = await db
    .insert(extractionJobs)
    .values({
      schemaId,
      userId,
      url,
      status: "pending",
      authConfig: opts.authConfig ?? null,
      paginationConfig: opts.paginationConfig ?? null,
    })
    .returning();

  const startTime = Date.now();

  try {
    // Update status to running
    await db
      .update(extractionJobs)
      .set({ status: "running" })
      .where(eq(extractionJobs.id, job.id));

    const extractionSchema = schema.schema as ExtractionSchema;

    // Handle authentication if needed
    const headers = await buildRequestHeaders(opts.authConfig);

    // Fetch main page
    const html = await fetchPage(url, headers);
    const mainResult = await extractFromHtml(html, extractionSchema);

    const pageResults: ExtractionResult[] = [mainResult];
    let pagesProcessed = 1;

    // Handle pagination if configured
    if (opts.paginationConfig) {
      const paginationResults = await handlePagination(
        url,
        opts.paginationConfig,
        extractionSchema,
        headers,
      );
      pageResults.push(...paginationResults.results);
      pagesProcessed += paginationResults.pagesProcessed;
    }

    // Merge all page results
    const merged = mergePageResults(pageResults);

    const executionTimeMs = Date.now() - startTime;

    // Update job with results
    const [updated] = await db
      .update(extractionJobs)
      .set({
        status: "completed",
        result: merged as any,
        extractedRows: merged.totalRows,
        pagesProcessed,
        executionTimeMs,
      })
      .where(eq(extractionJobs.id, job.id))
      .returning();

    return updated;
  } catch (error) {
    const executionTimeMs = Date.now() - startTime;
    const errMsg = error instanceof Error ? error.message : String(error);

    logger.error("Extraction job failed", { jobId: job.id, error: errMsg });

    const [updated] = await db
      .update(extractionJobs)
      .set({
        status: "failed",
        errorMessage: errMsg,
        executionTimeMs,
      })
      .where(eq(extractionJobs.id, job.id))
      .returning();

    return updated;
  }
}

/* ── Page Fetching ─────────────────────────────────────────────────── */

async function buildRequestHeaders(
  authConfig?: { type: string; credentials: Record<string, string> } | null,
): Promise<Record<string, string>> {
  const headers = buildStealthHeaders("moderate");

  if (authConfig) {
    switch (authConfig.type) {
      case "bearer":
        if (authConfig.credentials.token) {
          headers["Authorization"] = `Bearer ${authConfig.credentials.token}`;
        }
        break;
      case "basic": {
        const { username, password } = authConfig.credentials;
        if (username && password) {
          const encoded = Buffer.from(`${username}:${password}`).toString("base64");
          headers["Authorization"] = `Basic ${encoded}`;
        }
        break;
      }
      case "cookie":
        if (authConfig.credentials.cookie) {
          headers["Cookie"] = authConfig.credentials.cookie;
        }
        break;
      case "header":
        if (authConfig.credentials.name && authConfig.credentials.value) {
          headers[authConfig.credentials.name] = authConfig.credentials.value;
        }
        break;
    }
  }

  return headers;
}

async function fetchPage(url: string, headers: Record<string, string>): Promise<string> {
  const resp = await fetch(url, {
    headers,
    signal: AbortSignal.timeout(30_000),
    redirect: "follow",
  });

  if (!resp.ok) {
    throw new Error(`Failed to fetch ${url}: ${resp.status} ${resp.statusText}`);
  }

  return resp.text();
}

/* ── Core LLM Extraction ───────────────────────────────────────────── */

/**
 * Extract structured data from HTML using LLM.
 */
export async function extractFromHtml(
  html: string,
  schema: ExtractionSchema,
): Promise<ExtractionResult> {
  const prompt = buildExtractionPrompt(schema, html);

  const messages: AdapterMessage[] = [
    { role: "user", content: prompt },
  ];

  const chunks: string[] = [];
  for await (const chunk of routeAndCollect(messages, {
    systemMessage: "You are a structured data extraction engine. Extract data from HTML and return clean JSON arrays.",
    temperature: 0.1,
  })) {
    if (typeof chunk === "string") chunks.push(chunk);
  }

  const llmOutput = chunks.join("");
  return parseExtractionResult(llmOutput, schema);
}

/* ── Pagination ────────────────────────────────────────────────────── */

interface PaginationResult {
  results: ExtractionResult[];
  pagesProcessed: number;
}

export async function handlePagination(
  baseUrl: string,
  config: { type: string; selector?: string; maxPages?: number } | null,
  schema: ExtractionSchema,
  headers: Record<string, string>,
): Promise<PaginationResult> {
  if (!config) return { results: [], pagesProcessed: 0 };

  const maxPages = Math.min(config.maxPages ?? 5, 10);
  const results: ExtractionResult[] = [];
  let pagesProcessed = 0;

  if (config.type === "page-number") {
    // URL-based pagination: ?page=2, ?page=3, etc.
    for (let page = 2; page <= maxPages + 1; page++) {
      try {
        const url = new URL(baseUrl);
        url.searchParams.set("page", String(page));
        const html = await fetchPage(url.toString(), headers);
        const result = await extractFromHtml(html, schema);
        pagesProcessed++;

        if (result.rows.length === 0) break; // No more data
        results.push(result);
      } catch (error) {
        logger.warn("Pagination: page fetch failed", { page, error: String(error) });
        break;
      }
    }
  } else if (config.type === "offset") {
    // Offset-based: ?offset=20, ?offset=40, etc.
    const pageSize = 20;
    for (let i = 1; i <= maxPages; i++) {
      try {
        const url = new URL(baseUrl);
        url.searchParams.set("offset", String(i * pageSize));
        const html = await fetchPage(url.toString(), headers);
        const result = await extractFromHtml(html, schema);
        pagesProcessed++;

        if (result.rows.length === 0) break;
        results.push(result);
      } catch (error) {
        logger.warn("Pagination: offset fetch failed", { offset: i * pageSize, error: String(error) });
        break;
      }
    }
  } else if (config.type === "next-link") {
    // The LLM will identify next-page links from the HTML
    let currentUrl = baseUrl;
    for (let i = 0; i < maxPages; i++) {
      try {
        const html = await fetchPage(currentUrl, headers);
        const nextUrl = await findNextPageLink(html, currentUrl);
        if (!nextUrl) break;

        validateSafeUrl(nextUrl);
        const result = await extractFromHtml(await fetchPage(nextUrl, headers), schema);
        pagesProcessed++;

        if (result.rows.length === 0) break;
        results.push(result);
        currentUrl = nextUrl;
      } catch (error) {
        logger.warn("Pagination: next-link follow failed", { error: String(error) });
        break;
      }
    }
  }

  return { results, pagesProcessed };
}

async function findNextPageLink(html: string, currentUrl: string): Promise<string | null> {
  // Use a simple heuristic first: look for common "next" link patterns
  const nextPatterns = [
    /href="([^"]*)"[^>]*>\s*(?:Next|next|>>|>|&gt;|&raquo;|Next\s*Page)\s*</i,
    /rel="next"\s+href="([^"]*)"/i,
    /href="([^"]*)"\s+rel="next"/i,
  ];

  for (const pattern of nextPatterns) {
    const match = html.match(pattern);
    if (match?.[1]) {
      try {
        return new URL(match[1], currentUrl).toString();
      } catch {
        continue;
      }
    }
  }

  return null;
}

/**
 * Handle infinite scroll pages by simulating scroll-to-load-more.
 * In the zero-dependency implementation, this just fetches with page/offset params.
 */
export async function handleInfiniteScroll(
  url: string,
  scrollConfig: { maxScrolls?: number; loadMoreSelector?: string } | null,
): Promise<string[]> {
  if (!scrollConfig) return [];

  // Without a real browser, we fall back to offset-based fetching
  const maxScrolls = Math.min(scrollConfig.maxScrolls ?? 5, 10);
  const pages: string[] = [];

  for (let i = 1; i <= maxScrolls; i++) {
    try {
      const pageUrl = new URL(url);
      pageUrl.searchParams.set("page", String(i + 1));
      const headers = buildStealthHeaders("moderate");
      const html = await fetchPage(pageUrl.toString(), headers);
      pages.push(html);
    } catch {
      break;
    }
  }

  return pages;
}

/**
 * Handle authentication before extraction.
 * Returns headers with auth credentials attached.
 */
export async function handleAuthentication(
  url: string,
  authConfig: { type: string; credentials: Record<string, string> } | null,
): Promise<Record<string, string>> {
  return buildRequestHeaders(authConfig);
}

/* ── Job Queries ───────────────────────────────────────────────────── */

export async function getExtractionJobs(userId: number, schemaId?: number) {
  if (schemaId) {
    return db
      .select()
      .from(extractionJobs)
      .where(and(eq(extractionJobs.userId, userId), eq(extractionJobs.schemaId, schemaId)))
      .orderBy(desc(extractionJobs.createdAt));
  }

  return db
    .select()
    .from(extractionJobs)
    .where(eq(extractionJobs.userId, userId))
    .orderBy(desc(extractionJobs.createdAt));
}

export async function getExtractionJobById(id: number, userId: number) {
  const [job] = await db
    .select()
    .from(extractionJobs)
    .where(and(eq(extractionJobs.id, id), eq(extractionJobs.userId, userId)))
    .limit(1);

  return job ?? null;
}

export async function cancelExtraction(id: number, userId: number) {
  const job = await getExtractionJobById(id, userId);
  if (!job) return null;

  if (job.status !== "pending" && job.status !== "running") {
    throw new Error("Can only cancel pending or running jobs");
  }

  const [updated] = await db
    .update(extractionJobs)
    .set({ status: "failed", errorMessage: "Cancelled by user" })
    .where(and(eq(extractionJobs.id, id), eq(extractionJobs.userId, userId)))
    .returning();

  return updated ?? null;
}

/* ── Templates ─────────────────────────────────────────────────────── */

export async function getExtractionTemplates(category?: string) {
  // First try DB templates
  if (category) {
    const dbTemplates = await db
      .select()
      .from(extractionTemplates)
      .where(eq(extractionTemplates.category, category))
      .orderBy(extractionTemplates.name);

    if (dbTemplates.length > 0) return dbTemplates;

    // Fall back to built-in templates filtered by category
    return BUILTIN_TEMPLATES.filter((t) => t.category === category);
  }

  const dbTemplates = await db
    .select()
    .from(extractionTemplates)
    .orderBy(extractionTemplates.name);

  if (dbTemplates.length > 0) return dbTemplates;

  return BUILTIN_TEMPLATES;
}

/* ── Preview ───────────────────────────────────────────────────────── */

/**
 * Quick preview extraction: fetch first page only, return partial results.
 */
export async function previewExtraction(
  url: string,
  schema: ExtractionSchema,
): Promise<ExtractionResult> {
  validateSafeUrl(url);
  const headers = buildStealthHeaders("moderate");
  const html = await fetchPage(url, headers);
  return extractFromHtml(html, schema);
}

/* ── Export ─────────────────────────────────────────────────────────── */

/**
 * Export extraction job results in the requested format.
 */
export async function exportResult(
  jobId: number,
  userId: number,
  format: "json" | "csv" | "table" = "json",
): Promise<{ data: string; contentType: string; filename: string }> {
  const job = await getExtractionJobById(jobId, userId);
  if (!job) throw new Error("Extraction job not found");
  if (job.status !== "completed" || !job.result) {
    throw new Error("Job has no results to export");
  }

  const result = job.result as ExtractionResult;
  const rows = result.rows ?? [];

  // Get schema fields for column ordering
  let fields: SchemaField[] | undefined;
  const schema = await getSchemaById(job.schemaId, job.userId);
  if (schema?.schema) {
    const s = schema.schema as ExtractionSchema;
    fields = s.fields;
  }

  const data = convertToFormat(rows, format, fields);

  const contentTypes: Record<string, string> = {
    json: "application/json",
    csv: "text/csv",
    table: "text/plain",
  };

  const extensions: Record<string, string> = {
    json: "json",
    csv: "csv",
    table: "txt",
  };

  return {
    data,
    contentType: contentTypes[format] ?? "application/json",
    filename: `extraction-${jobId}.${extensions[format] ?? "json"}`,
  };
}
