/**
 * Web Scraping Service — multi-provider web content extraction.
 *
 * Supports: Firecrawl (scrape + crawl), Exa (semantic search + content), native fetch fallback.
 */

import { env } from "../config/env.js";
import logger from "../lib/logger.js";
import { validateSafeUrl } from "../lib/ssrf.js";

/* ── Types ─────────────────────────────────────────────────────────── */

export interface ScrapeResult {
  url: string;
  title: string;
  content: string;
  markdown?: string;
  metadata?: Record<string, unknown>;
}

export interface CrawlOptions {
  url: string;
  maxPages?: number;
  maxDepth?: number;
  provider?: "firecrawl" | "native";
}

export interface ExaSearchOptions {
  query: string;
  numResults?: number;
  type?: "keyword" | "neural" | "auto";
  useAutoprompt?: boolean;
  includeContent?: boolean;
  startDate?: string;
  endDate?: string;
}

export interface ExaResult {
  title: string;
  url: string;
  content?: string;
  score: number;
  publishedDate?: string;
  author?: string;
}

/* ── Firecrawl ─────────────────────────────────────────────────────── */

const FIRECRAWL_BASE = "https://api.firecrawl.dev/v1";

/**
 * Scrape a single URL using Firecrawl.
 * Returns clean markdown content with metadata.
 */
export async function firecrawlScrape(url: string): Promise<ScrapeResult> {
  if (!env.FIRECRAWL_API_KEY) throw new Error("FIRECRAWL_API_KEY not configured");
  validateSafeUrl(url);

  const resp = await fetch(`${FIRECRAWL_BASE}/scrape`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.FIRECRAWL_API_KEY}`,
    },
    body: JSON.stringify({
      url,
      formats: ["markdown", "html"],
    }),
    signal: AbortSignal.timeout(30_000),
  });

  if (!resp.ok) {
    const err = await resp.text().catch(() => resp.statusText);
    throw new Error(`Firecrawl scrape error ${resp.status}: ${err}`);
  }

  const data = (await resp.json()) as {
    success: boolean;
    data?: {
      markdown?: string;
      html?: string;
      metadata?: { title?: string; description?: string; [k: string]: unknown };
    };
  };

  if (!data.success || !data.data) throw new Error("Firecrawl scrape returned no data");

  return {
    url,
    title: data.data.metadata?.title || url,
    content: data.data.html || "",
    markdown: data.data.markdown || "",
    metadata: data.data.metadata,
  };
}

/**
 * Crawl a website using Firecrawl. Returns multiple pages.
 */
export async function firecrawlCrawl(options: CrawlOptions): Promise<ScrapeResult[]> {
  if (!env.FIRECRAWL_API_KEY) throw new Error("FIRECRAWL_API_KEY not configured");
  validateSafeUrl(options.url);

  // Start crawl job
  const resp = await fetch(`${FIRECRAWL_BASE}/crawl`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.FIRECRAWL_API_KEY}`,
    },
    body: JSON.stringify({
      url: options.url,
      limit: options.maxPages || 10,
      maxDepth: options.maxDepth || 2,
      scrapeOptions: { formats: ["markdown"] },
    }),
    signal: AbortSignal.timeout(15_000),
  });

  if (!resp.ok) throw new Error(`Firecrawl crawl error: ${resp.status}`);
  const job = (await resp.json()) as { success: boolean; id?: string };
  if (!job.success || !job.id) throw new Error("Failed to start Firecrawl crawl job");

  // Poll for results (max 60s)
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 2000));

    const statusResp = await fetch(`${FIRECRAWL_BASE}/crawl/${job.id}`, {
      headers: { Authorization: `Bearer ${env.FIRECRAWL_API_KEY}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!statusResp.ok) continue;

    const status = (await statusResp.json()) as {
      status: string;
      data?: Array<{
        markdown?: string;
        metadata?: { title?: string; sourceURL?: string; [k: string]: unknown };
      }>;
    };

    if (status.status === "completed" && status.data) {
      return status.data.map(page => ({
        url: page.metadata?.sourceURL || options.url,
        title: page.metadata?.title || "",
        content: page.markdown || "",
        markdown: page.markdown,
        metadata: page.metadata,
      }));
    }

    if (status.status === "failed") throw new Error("Firecrawl crawl job failed");
  }

  throw new Error("Firecrawl crawl timed out after 60s");
}

/* ── Exa ───────────────────────────────────────────────────────────── */

const EXA_BASE = "https://api.exa.ai";

/**
 * Search using Exa's semantic search API.
 * Returns results with optional full content extraction.
 */
export async function exaSearch(options: ExaSearchOptions): Promise<ExaResult[]> {
  if (!env.EXA_API_KEY) throw new Error("EXA_API_KEY not configured");

  const body: Record<string, unknown> = {
    query: options.query,
    numResults: options.numResults || 10,
    type: options.type || "auto",
    useAutoprompt: options.useAutoprompt ?? true,
  };
  if (options.startDate) body.startPublishedDate = options.startDate;
  if (options.endDate) body.endPublishedDate = options.endDate;

  // Use /search or /search+contents based on includeContent flag
  const endpoint = options.includeContent ? "/search" : "/search";
  const contents = options.includeContent ? { text: { maxCharacters: 3000 } } : undefined;
  if (contents) body.contents = contents;

  const resp = await fetch(`${EXA_BASE}${endpoint}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": env.EXA_API_KEY,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });

  if (!resp.ok) {
    const err = await resp.text().catch(() => resp.statusText);
    throw new Error(`Exa search error ${resp.status}: ${err}`);
  }

  const data = (await resp.json()) as {
    results?: Array<{
      title: string;
      url: string;
      text?: string;
      score: number;
      publishedDate?: string;
      author?: string;
    }>;
  };

  return (data.results || []).map(r => ({
    title: r.title,
    url: r.url,
    content: r.text,
    score: r.score,
    publishedDate: r.publishedDate,
    author: r.author,
  }));
}

/**
 * Get content from specific URLs using Exa.
 */
export async function exaGetContents(urls: string[]): Promise<ExaResult[]> {
  if (!env.EXA_API_KEY) throw new Error("EXA_API_KEY not configured");

  const resp = await fetch(`${EXA_BASE}/contents`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": env.EXA_API_KEY,
    },
    body: JSON.stringify({
      ids: urls,
      text: { maxCharacters: 5000 },
    }),
    signal: AbortSignal.timeout(15_000),
  });

  if (!resp.ok) throw new Error(`Exa contents error: ${resp.status}`);

  const data = (await resp.json()) as {
    results?: Array<{
      title: string;
      url: string;
      text?: string;
      score?: number;
    }>;
  };

  return (data.results || []).map(r => ({
    title: r.title,
    url: r.url,
    content: r.text,
    score: r.score || 0,
  }));
}

/* ── Unified Scrape API ────────────────────────────────────────────── */

/**
 * Scrape a URL using the best available provider.
 * Priority: Firecrawl > native fetch.
 */
export async function scrapeUrl(url: string): Promise<ScrapeResult> {
  validateSafeUrl(url);

  if (env.FIRECRAWL_API_KEY) {
    try {
      return await firecrawlScrape(url);
    } catch (err) {
      logger.warn({ err: (err as Error).message }, "Firecrawl scrape failed, falling back to native");
    }
  }

  // Native fallback
  const safeUrl = await validateSafeUrl(url);
  const resp = await fetch(safeUrl, {
    headers: { "User-Agent": "aibyai-bot/1.0" },
    signal: AbortSignal.timeout(10_000),
  });
  if (!resp.ok) throw new Error(`Failed to fetch ${url}: ${resp.status}`);

  const html = await resp.text();
  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  // State machine approach — no regex on HTML structure (avoids incomplete sanitization)
  const buf: string[] = [];
  let i = 0;
  const hlen = html.length;
  const lower = html.toLowerCase();
  while (i < hlen) {
    if (html[i] !== "<") { buf.push(html[i++]); continue; }
    let blockClose: string | null = null;
    if (lower.startsWith("<script", i) && (i + 7 >= hlen || " \t\r\n>/<".includes(lower[i + 7]))) {
      blockClose = "</script>";
    } else if (lower.startsWith("<style", i) && (i + 6 >= hlen || " \t\r\n>/<".includes(lower[i + 6]))) {
      blockClose = "</style>";
    }
    if (blockClose) {
      const closeIdx = lower.indexOf(blockClose, i);
      i = closeIdx !== -1 ? closeIdx + blockClose.length : hlen;
    } else {
      buf.push(" ");
      while (i < hlen && html[i] !== ">") i++;
      if (i < hlen) i++;
    }
  }
  const text = buf.join("").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim().slice(0, 10_000);

  return {
    url,
    title: titleMatch?.[1]?.trim() || url,
    content: text,
  };
}

/**
 * Check which scraping/extraction providers are available.
 */
export function listAvailableScrapingProviders(): string[] {
  const providers: string[] = ["native"];
  if (env.FIRECRAWL_API_KEY) providers.unshift("firecrawl");
  if (env.EXA_API_KEY) providers.push("exa");
  return providers;
}
