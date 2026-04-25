/**
 * Feedback service — captures thumbs up/down on AI responses and search results
 * to support retrieval quality improvements and fine-tuning dataset export.
 */
import { randomUUID } from "crypto";
import { db } from "../lib/drizzle.js";
import { responseFeedback, searchFeedback } from "../db/schema/feedback.js";
import { eq, and, gte, lte, count, sql } from "drizzle-orm";
import { AppError } from "../middleware/errorHandler.js";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ResponseFeedbackData {
  conversationId: string;
  messageIndex: number;
  userId: number;
  rating: "positive" | "negative";
  feedbackText?: string;
  qualityIssues?: string[];
  selectedText?: string;
  improvedAnswer?: string;
  documentIds?: string[];
}

export interface SearchFeedbackData {
  query: string;
  documentId: string;
  userId: number;
  isRelevant: boolean;
  tenantId?: string;
}

export interface DateRange {
  from?: Date;
  to?: Date;
}

// ─── Response feedback ───────────────────────────────────────────────────────

export async function submitResponseFeedback(data: ResponseFeedbackData) {
  if (data.rating !== "positive" && data.rating !== "negative") {
    throw new AppError(400, "rating must be 'positive' or 'negative'");
  }

  const [inserted] = await db
    .insert(responseFeedback)
    .values({
      id: randomUUID(),
      conversationId: data.conversationId,
      messageIndex: data.messageIndex,
      userId: data.userId,
      rating: data.rating,
      feedbackText: data.feedbackText ?? null,
      qualityIssues: data.qualityIssues ?? [],
      selectedText: data.selectedText ?? null,
      improvedAnswer: data.improvedAnswer ?? null,
      documentIds: data.documentIds ?? [],
    })
    .returning();

  // Future: emit re-ranking signal to retrieval system here
  // e.g. await rerankingQueue.add('feedback', { feedbackId: inserted.id });

  return inserted;
}

// ─── Search feedback ─────────────────────────────────────────────────────────

export async function submitSearchFeedback(data: SearchFeedbackData) {
  const [inserted] = await db
    .insert(searchFeedback)
    .values({
      id: randomUUID(),
      query: data.query,
      documentId: data.documentId,
      userId: data.userId,
      isRelevant: data.isRelevant,
      tenantId: data.tenantId ?? null,
    })
    .returning();

  return inserted;
}

// ─── Stats ───────────────────────────────────────────────────────────────────

export async function getFeedbackStats(tenantId?: string, dateRange?: DateRange) {
  // Build date filters
  const conditions = [];
  if (dateRange?.from) {
    conditions.push(gte(responseFeedback.createdAt, dateRange.from));
  }
  if (dateRange?.to) {
    conditions.push(lte(responseFeedback.createdAt, dateRange.to));
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  // Total counts by rating
  const [totalRow] = await db
    .select({ total: count() })
    .from(responseFeedback)
    .where(whereClause);

  const [positiveRow] = await db
    .select({ total: count() })
    .from(responseFeedback)
    .where(whereClause ? and(whereClause, eq(responseFeedback.rating, "positive")) : eq(responseFeedback.rating, "positive"));

  const total = totalRow?.total ?? 0;
  const positive = positiveRow?.total ?? 0;
  const positiveRate = total > 0 ? (positive / total) * 100 : 0;

  // Most common quality issues (aggregate across all jsonb arrays)
  const issueRows = await db
    .select({
      issues: responseFeedback.qualityIssues,
    })
    .from(responseFeedback)
    .where(and(whereClause, eq(responseFeedback.rating, "negative")))
    .limit(500);

  const issueCounts: Record<string, number> = {};
  for (const row of issueRows) {
    const issues = row.issues as string[];
    if (Array.isArray(issues)) {
      for (const issue of issues) {
        issueCounts[issue] = (issueCounts[issue] ?? 0) + 1;
      }
    }
  }

  const commonIssues = Object.entries(issueCounts)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 10)
    .map(([issue, occurrences]) => ({ issue, occurrences }));

  // Search feedback stats
  const searchConditions = [];
  if (tenantId) {
    searchConditions.push(eq(searchFeedback.tenantId, tenantId));
  }
  if (dateRange?.from) {
    searchConditions.push(gte(searchFeedback.createdAt, dateRange.from));
  }
  if (dateRange?.to) {
    searchConditions.push(lte(searchFeedback.createdAt, dateRange.to));
  }

  const searchWhere = searchConditions.length > 0 ? and(...searchConditions) : undefined;

  const [searchTotalRow] = await db
    .select({ total: count() })
    .from(searchFeedback)
    .where(searchWhere);

  const [searchRelevantRow] = await db
    .select({ total: count() })
    .from(searchFeedback)
    .where(searchWhere ? and(searchWhere, eq(searchFeedback.isRelevant, true)) : eq(searchFeedback.isRelevant, true));

  const searchTotal = searchTotalRow?.total ?? 0;
  const searchRelevant = searchRelevantRow?.total ?? 0;

  return {
    responseFeedback: {
      total,
      positive,
      negative: total - positive,
      positiveRate: Math.round(positiveRate * 100) / 100,
    },
    commonIssues,
    searchFeedback: {
      total: searchTotal,
      relevant: searchRelevant,
      irrelevant: searchTotal - searchRelevant,
      relevanceRate:
        searchTotal > 0
          ? Math.round((searchRelevant / searchTotal) * 10000) / 100
          : 0,
    },
  };
}

// ─── Per-conversation ─────────────────────────────────────────────────────────

export async function getFeedbackForConversation(conversationId: string) {
  return db
    .select()
    .from(responseFeedback)
    .where(eq(responseFeedback.conversationId, conversationId))
    .orderBy(responseFeedback.messageIndex);
}

// ─── Export ───────────────────────────────────────────────────────────────────

export async function exportFeedback(
  tenantId: string | undefined,
  format: "json" | "csv"
): Promise<string> {
  const conditions = [];
  if (tenantId) {
    // ResponseFeedback doesn't have tenantId, so we can only filter search feedback.
    // For response feedback, return all (add a tenantId column in a future migration if needed).
  }

  const responseFeedbackRows = await db
    .select()
    .from(responseFeedback)
    .orderBy(responseFeedback.createdAt);

  const searchFeedbackRows = await db
    .select()
    .from(searchFeedback)
    .where(tenantId ? eq(searchFeedback.tenantId, tenantId) : undefined)
    .orderBy(searchFeedback.createdAt);

  if (format === "json") {
    return JSON.stringify(
      {
        exportedAt: new Date().toISOString(),
        responseFeedback: responseFeedbackRows,
        searchFeedback: searchFeedbackRows,
      },
      null,
      2
    );
  }

  // CSV export — response feedback only (richer structure for fine-tuning)
  const headers = [
    "id",
    "conversationId",
    "messageIndex",
    "userId",
    "rating",
    "feedbackText",
    "qualityIssues",
    "improvedAnswer",
    "createdAt",
  ];

  const escape = (v: unknown): string => {
    const s = v === null || v === undefined ? "" : String(v);
    return `"${s.replace(/"/g, '""')}"`;
  };

  const rows = responseFeedbackRows.map((r) =>
    [
      r.id,
      r.conversationId,
      r.messageIndex,
      r.userId,
      r.rating,
      r.feedbackText ?? "",
      Array.isArray(r.qualityIssues) ? (r.qualityIssues as string[]).join(";") : "",
      r.improvedAnswer ?? "",
      r.createdAt,
    ]
      .map(escape)
      .join(",")
  );

  return [headers.join(","), ...rows].join("\n");
}
