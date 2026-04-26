/**
 * Web Selectors Service — Phase 3.12
 *
 * CRUD operations for natural language web selectors, LLM-based resolution,
 * execution (fetch page + extract content), self-healing, and batch operations.
 */

import { db } from "../lib/drizzle.js";
import { webSelectors, webSelectorExecutions } from "../db/schema/webSelectors.js";
import { eq, and, desc } from "drizzle-orm";
import { validateSafeUrl } from "../lib/ssrf.js";
import { buildStealthHeaders } from "../lib/stealthBrowser.js";
import logger from "../lib/logger.js";
import {
  generateCandidateSelectors,
  selfHealingResolve,
  extractWithSelector,
  scoreSelectorConfidence,
  inferSelectorType,
  type CandidateSelector,
  type ExtractionResult,
} from "../lib/selectorEngine.js";

/* ── Types ─────────────────────────────────────────────────────────── */

export interface CreateSelectorInput {
  name: string;
  description: string;
  url?: string;
  selectorType?: "css" | "xpath" | "aria";
}

export interface UpdateSelectorInput {
  name?: string;
  description?: string;
  url?: string;
  selectorType?: "css" | "xpath" | "aria";
}

export interface ResolveResult {
  candidates: CandidateSelector[];
  bestSelector: string | null;
  bestType: "css" | "xpath" | "aria";
  confidence: number;
}

export interface ExecutionResult {
  success: boolean;
  selector: string;
  selectorType: "css" | "xpath" | "aria";
  content: string | null;
  confidence: number;
  executionTimeMs: number;
  error?: string;
}

/* ── CRUD ──────────────────────────────────────────────────────────── */

export async function createSelector(userId: number, input: CreateSelectorInput) {
  const [selector] = await db
    .insert(webSelectors)
    .values({
      userId,
      name: input.name,
      description: input.description,
      url: input.url ?? null,
      selectorType: input.selectorType ?? "css",
    })
    .returning();

  return selector;
}

export async function getSelectors(userId: number) {
  return db
    .select()
    .from(webSelectors)
    .where(eq(webSelectors.userId, userId))
    .orderBy(desc(webSelectors.createdAt));
}

export async function getSelectorById(id: number, userId: number) {
  const [selector] = await db
    .select()
    .from(webSelectors)
    .where(and(eq(webSelectors.id, id), eq(webSelectors.userId, userId)))
    .limit(1);

  return selector ?? null;
}

export async function updateSelector(id: number, userId: number, input: UpdateSelectorInput) {
  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (input.name !== undefined) updates.name = input.name;
  if (input.description !== undefined) updates.description = input.description;
  if (input.url !== undefined) updates.url = input.url;
  if (input.selectorType !== undefined) updates.selectorType = input.selectorType;

  const [updated] = await db
    .update(webSelectors)
    .set(updates)
    .where(and(eq(webSelectors.id, id), eq(webSelectors.userId, userId)))
    .returning();

  return updated ?? null;
}

export async function deleteSelector(id: number, userId: number) {
  // Delete executions first (cascade not enforced in code, manual cleanup)
  await db
    .delete(webSelectorExecutions)
    .where(eq(webSelectorExecutions.selectorId, id));

  const [deleted] = await db
    .delete(webSelectors)
    .where(and(eq(webSelectors.id, id), eq(webSelectors.userId, userId)))
    .returning();

  return deleted ?? null;
}

/* ── Resolution ────────────────────────────────────────────────────── */

/**
 * Resolve a natural language description to a CSS/XPath/ARIA selector.
 * Fetches the page if URL is provided but no HTML is given.
 */
export async function resolveSelector(
  description: string,
  url?: string,
  pageHtml?: string,
): Promise<ResolveResult> {
  let html = pageHtml;

  if (!html && url) {
    html = await fetchPageHtml(url);
  }

  if (!html) {
    return { candidates: [], bestSelector: null, bestType: "css", confidence: 0 };
  }

  const candidates = await generateCandidateSelectors(description, html);

  if (candidates.length === 0) {
    return { candidates: [], bestSelector: null, bestType: "css", confidence: 0 };
  }

  // Re-score candidates against actual HTML
  const scored = candidates.map(c => ({
    ...c,
    confidence: Math.max(
      c.confidence,
      scoreSelectorConfidence(c.selector, html!, description),
    ),
  }));

  scored.sort((a, b) => b.confidence - a.confidence);

  const best = scored[0];
  return {
    candidates: scored,
    bestSelector: best.selector,
    bestType: best.type,
    confidence: best.confidence,
  };
}

/* ── Execution ─────────────────────────────────────────────────────── */

/**
 * Execute a stored selector against a URL: fetch page, resolve if needed,
 * extract content, and log the execution.
 */
export async function executeSelector(
  selectorId: number,
  url: string,
  userId: number,
): Promise<ExecutionResult> {
  const startMs = Date.now();

  const selector = await getSelectorById(selectorId, userId);
  if (!selector) {
    return {
      success: false,
      selector: "",
      selectorType: "css",
      content: null,
      confidence: 0,
      executionTimeMs: Date.now() - startMs,
      error: "Selector not found",
    };
  }

  try {
    validateSafeUrl(url);
    const html = await fetchPageHtml(url);

    let resolvedSelector = selector.resolvedSelector;
    let selectorType = selector.selectorType as "css" | "xpath" | "aria";

    // If no cached selector, or fail count is high, re-resolve
    if (!resolvedSelector || selector.failCount >= 3) {
      const resolution = await resolveSelector(selector.description, undefined, html);
      if (resolution.bestSelector) {
        resolvedSelector = resolution.bestSelector;
        selectorType = resolution.bestType;

        // Cache the resolved selector
        await db
          .update(webSelectors)
          .set({
            resolvedSelector,
            selectorType,
            confidence: resolution.confidence,
            lastResolvedAt: new Date(),
            failCount: 0,
            updatedAt: new Date(),
          })
          .where(eq(webSelectors.id, selectorId));
      }
    }

    if (!resolvedSelector) {
      const result: ExecutionResult = {
        success: false,
        selector: "",
        selectorType,
        content: null,
        confidence: 0,
        executionTimeMs: Date.now() - startMs,
        error: "Could not resolve selector from description",
      };
      await logExecution(selectorId, url, result);
      return result;
    }

    // Extract content
    const extraction = extractWithSelector(html, resolvedSelector, selectorType);

    if (!extraction.matched) {
      // Attempt self-healing
      const healed = await selfHealSelector(selectorId, url, userId);
      return healed;
    }

    const executionTimeMs = Date.now() - startMs;
    const result: ExecutionResult = {
      success: true,
      selector: resolvedSelector,
      selectorType,
      content: extraction.content,
      confidence: selector.confidence ?? 0,
      executionTimeMs,
    };

    await logExecution(selectorId, url, result);
    return result;
  } catch (err) {
    const executionTimeMs = Date.now() - startMs;
    const errorMessage = err instanceof Error ? err.message : "Unknown error";

    // Increment fail count
    await db
      .update(webSelectors)
      .set({
        failCount: (selector.failCount ?? 0) + 1,
        updatedAt: new Date(),
      })
      .where(eq(webSelectors.id, selectorId));

    const result: ExecutionResult = {
      success: false,
      selector: selector.resolvedSelector ?? "",
      selectorType: selector.selectorType as "css" | "xpath" | "aria",
      content: null,
      confidence: 0,
      executionTimeMs,
      error: errorMessage,
    };

    await logExecution(selectorId, url, result);
    return result;
  }
}

/**
 * Execute multiple selectors against the same URL (one fetch, multiple extractions).
 */
export async function batchExecute(
  selectorIds: number[],
  url: string,
  userId: number,
): Promise<ExecutionResult[]> {
  validateSafeUrl(url);
  const html = await fetchPageHtml(url);

  const results: ExecutionResult[] = [];

  for (const selectorId of selectorIds) {
    const startMs = Date.now();
    const selector = await getSelectorById(selectorId, userId);

    if (!selector) {
      results.push({
        success: false,
        selector: "",
        selectorType: "css",
        content: null,
        confidence: 0,
        executionTimeMs: Date.now() - startMs,
        error: "Selector not found",
      });
      continue;
    }

    let resolvedSelector = selector.resolvedSelector;
    let selectorType = selector.selectorType as "css" | "xpath" | "aria";

    if (!resolvedSelector) {
      const resolution = await resolveSelector(selector.description, undefined, html);
      if (resolution.bestSelector) {
        resolvedSelector = resolution.bestSelector;
        selectorType = resolution.bestType;

        await db
          .update(webSelectors)
          .set({
            resolvedSelector,
            selectorType,
            confidence: resolution.confidence,
            lastResolvedAt: new Date(),
            failCount: 0,
            updatedAt: new Date(),
          })
          .where(eq(webSelectors.id, selectorId));
      }
    }

    if (!resolvedSelector) {
      const result: ExecutionResult = {
        success: false,
        selector: "",
        selectorType,
        content: null,
        confidence: 0,
        executionTimeMs: Date.now() - startMs,
        error: "Could not resolve selector",
      };
      await logExecution(selectorId, url, result);
      results.push(result);
      continue;
    }

    const extraction = extractWithSelector(html, resolvedSelector, selectorType);
    const executionTimeMs = Date.now() - startMs;

    const result: ExecutionResult = {
      success: extraction.matched,
      selector: resolvedSelector,
      selectorType,
      content: extraction.content,
      confidence: selector.confidence ?? 0,
      executionTimeMs,
      error: extraction.matched ? undefined : "Selector did not match any elements",
    };

    await logExecution(selectorId, url, result);
    results.push(result);
  }

  return results;
}

/* ── Self-Healing ──────────────────────────────────────────────────── */

/**
 * Re-resolve a broken selector using the previous selector as context.
 */
export async function selfHealSelector(
  selectorId: number,
  url: string,
  userId: number,
): Promise<ExecutionResult> {
  const startMs = Date.now();

  const selector = await getSelectorById(selectorId, userId);
  if (!selector) {
    return {
      success: false,
      selector: "",
      selectorType: "css",
      content: null,
      confidence: 0,
      executionTimeMs: Date.now() - startMs,
      error: "Selector not found",
    };
  }

  try {
    validateSafeUrl(url);
    const html = await fetchPageHtml(url);

    const candidates = await selfHealingResolve(
      selector.description,
      html,
      selector.resolvedSelector,
    );

    if (candidates.length === 0) {
      const result: ExecutionResult = {
        success: false,
        selector: selector.resolvedSelector ?? "",
        selectorType: selector.selectorType as "css" | "xpath" | "aria",
        content: null,
        confidence: 0,
        executionTimeMs: Date.now() - startMs,
        error: "Self-healing failed: no viable replacement selectors found",
      };
      await logExecution(selectorId, url, result);

      await db
        .update(webSelectors)
        .set({ failCount: (selector.failCount ?? 0) + 1, updatedAt: new Date() })
        .where(eq(webSelectors.id, selectorId));

      return result;
    }

    // Try candidates until one works
    for (const candidate of candidates) {
      const extraction = extractWithSelector(html, candidate.selector, candidate.type);
      if (extraction.matched) {
        // Update cached selector
        await db
          .update(webSelectors)
          .set({
            resolvedSelector: candidate.selector,
            selectorType: candidate.type,
            confidence: candidate.confidence,
            lastResolvedAt: new Date(),
            failCount: 0,
            updatedAt: new Date(),
          })
          .where(eq(webSelectors.id, selectorId));

        const executionTimeMs = Date.now() - startMs;
        const result: ExecutionResult = {
          success: true,
          selector: candidate.selector,
          selectorType: candidate.type,
          content: extraction.content,
          confidence: candidate.confidence,
          executionTimeMs,
        };

        await logExecution(selectorId, url, result);

        logger.info(
          { selectorId, old: selector.resolvedSelector, new: candidate.selector },
          "Self-healed broken selector",
        );

        return result;
      }
    }

    // All candidates failed
    const result: ExecutionResult = {
      success: false,
      selector: selector.resolvedSelector ?? "",
      selectorType: selector.selectorType as "css" | "xpath" | "aria",
      content: null,
      confidence: 0,
      executionTimeMs: Date.now() - startMs,
      error: "Self-healing: all candidate selectors failed to match",
    };
    await logExecution(selectorId, url, result);
    return result;
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : "Unknown error";
    return {
      success: false,
      selector: selector.resolvedSelector ?? "",
      selectorType: selector.selectorType as "css" | "xpath" | "aria",
      content: null,
      confidence: 0,
      executionTimeMs: Date.now() - startMs,
      error: `Self-healing error: ${errorMessage}`,
    };
  }
}

/* ── Execution History ─────────────────────────────────────────────── */

export async function getSelectorExecutions(selectorId: number, limit = 50) {
  return db
    .select()
    .from(webSelectorExecutions)
    .where(eq(webSelectorExecutions.selectorId, selectorId))
    .orderBy(desc(webSelectorExecutions.createdAt))
    .limit(limit);
}

/* ── Cross-Site Selector Generation ────────────────────────────────── */

/**
 * Generate a selector that works across multiple similar sites by
 * analysing example URLs and finding common patterns.
 */
export async function generateSelectorFromExamples(
  description: string,
  exampleUrls: string[],
): Promise<ResolveResult> {
  const htmlPages: string[] = [];

  for (const url of exampleUrls.slice(0, 3)) {
    try {
      validateSafeUrl(url);
      const html = await fetchPageHtml(url);
      htmlPages.push(html);
    } catch (err) {
      logger.warn({ url, err }, "Failed to fetch example URL for cross-site selector");
    }
  }

  if (htmlPages.length === 0) {
    return { candidates: [], bestSelector: null, bestType: "css", confidence: 0 };
  }

  // Generate candidates for each page, then find common selectors
  const allCandidates: CandidateSelector[][] = [];
  for (const html of htmlPages) {
    const candidates = await generateCandidateSelectors(description, html);
    allCandidates.push(candidates);
  }

  // Find selectors that work on all pages
  if (allCandidates.length === 0) {
    return { candidates: [], bestSelector: null, bestType: "css", confidence: 0 };
  }

  const firstCandidates = allCandidates[0];
  const crossSiteCandidates: CandidateSelector[] = [];

  for (const candidate of firstCandidates) {
    let worksOnAll = true;
    let totalConfidence = candidate.confidence;

    for (let i = 1; i < htmlPages.length; i++) {
      const extraction = extractWithSelector(htmlPages[i], candidate.selector, candidate.type);
      if (!extraction.matched) {
        worksOnAll = false;
        break;
      }
      totalConfidence += scoreSelectorConfidence(candidate.selector, htmlPages[i], description);
    }

    if (worksOnAll) {
      crossSiteCandidates.push({
        ...candidate,
        confidence: totalConfidence / htmlPages.length,
        reasoning: `${candidate.reasoning} (works across ${htmlPages.length} sites)`,
      });
    }
  }

  crossSiteCandidates.sort((a, b) => b.confidence - a.confidence);

  if (crossSiteCandidates.length === 0) {
    // Fallback: return candidates from first page
    return {
      candidates: firstCandidates,
      bestSelector: firstCandidates[0]?.selector ?? null,
      bestType: firstCandidates[0]?.type ?? "css",
      confidence: (firstCandidates[0]?.confidence ?? 0) * 0.5, // Lower confidence for non-cross-site
    };
  }

  return {
    candidates: crossSiteCandidates,
    bestSelector: crossSiteCandidates[0].selector,
    bestType: crossSiteCandidates[0].type,
    confidence: crossSiteCandidates[0].confidence,
  };
}

/* ── Validation ────────────────────────────────────────────────────── */

/**
 * Validate that a selector matches at least one element in the given HTML.
 */
export function validateSelector(
  selector: string,
  selectorType: "css" | "xpath" | "aria",
  html: string,
): ExtractionResult {
  return extractWithSelector(html, selector, selectorType);
}

/* ── Helpers ───────────────────────────────────────────────────────── */

async function fetchPageHtml(url: string): Promise<string> {
  validateSafeUrl(url);

  const headers = buildStealthHeaders("moderate", url);
  const resp = await fetch(url, {
    headers,
    signal: AbortSignal.timeout(15_000),
    redirect: "follow",
  });

  if (!resp.ok) {
    throw new Error(`Failed to fetch ${url}: ${resp.status} ${resp.statusText}`);
  }

  return resp.text();
}

async function logExecution(
  selectorId: number,
  url: string,
  result: ExecutionResult,
): Promise<void> {
  try {
    await db
      .insert(webSelectorExecutions)
      .values({
        selectorId,
        url,
        success: result.success,
        resolvedSelector: result.selector || "N/A",
        extractedContent: result.content?.substring(0, 10_000) ?? null,
        executionTimeMs: result.executionTimeMs,
        errorMessage: result.error ?? null,
      });
  } catch (err) {
    logger.warn({ err, selectorId }, "Failed to log selector execution");
  }
}
