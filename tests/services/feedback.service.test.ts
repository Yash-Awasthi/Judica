vi.mock("../../src/middleware/errorHandler.js", () => ({
  AppError: class AppError extends Error {
    statusCode: number;
    constructor(code: number, msg: string) {
      super(msg);
      this.statusCode = code;
    }
  },
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((a, b) => ({ eq: true, a, b })),
  and: vi.fn((...args) => ({ and: true, args })),
  desc: vi.fn((col) => ({ desc: true, col })),
  count: vi.fn(() => "count(*)"),
  sql: vi.fn(() => "sql"),
  gte: vi.fn((a, b) => ({ gte: true, a, b })),
  lte: vi.fn((a, b) => ({ lte: true, a, b })),
}));

vi.mock("../../src/db/schema/feedback.js", () => ({
  responseFeedback: {
    id: "id",
    conversationId: "conversationId",
    messageIndex: "messageIndex",
    userId: "userId",
    rating: "rating",
    feedbackText: "feedbackText",
    qualityIssues: "qualityIssues",
    selectedText: "selectedText",
    improvedAnswer: "improvedAnswer",
    documentIds: "documentIds",
    createdAt: "createdAt",
  },
  searchFeedback: {
    id: "id",
    query: "query",
    documentId: "documentId",
    userId: "userId",
    isRelevant: "isRelevant",
    tenantId: "tenantId",
    createdAt: "createdAt",
  },
}));

// ─── Hoisted DB mocks ─────────────────────────────────────────────────────────
const {
  mockDbSelect,
  mockDbInsert,
  mockSelectFrom,
  mockInsertValues,
} = vi.hoisted(() => {
  const mockInsertReturning = vi.fn().mockResolvedValue([]);
  const mockInsertValues = vi.fn().mockReturnValue({ returning: mockInsertReturning });
  const mockDbInsert = vi.fn().mockReturnValue({ values: mockInsertValues });

  const mockSelectOrderBy = vi.fn().mockResolvedValue([]);
  const mockSelectWhere = vi.fn().mockReturnValue({ orderBy: mockSelectOrderBy });
  const mockSelectLimit = vi.fn().mockResolvedValue([]);
  const mockSelectFrom = vi.fn().mockReturnValue({
    where: mockSelectWhere,
    orderBy: mockSelectOrderBy,
  });
  const mockDbSelect = vi.fn().mockReturnValue({ from: mockSelectFrom });

  return {
    mockDbSelect,
    mockDbInsert,
    mockSelectFrom,
    mockInsertValues,
  };
});

vi.mock("../../src/lib/drizzle.js", () => ({
  db: {
    select: mockDbSelect,
    insert: mockDbInsert,
  },
}));

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  submitResponseFeedback,
  submitSearchFeedback,
  getFeedbackStats,
  getFeedbackForConversation,
  exportFeedback,
} from "../../src/services/feedback.service.js";
import { AppError } from "../../src/middleware/errorHandler.js";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const validResponseFeedback = {
  conversationId: "conv-abc-123",
  messageIndex: 2,
  userId: 7,
  rating: "positive" as const,
  feedbackText: "Great answer!",
  qualityIssues: [],
  selectedText: null,
  improvedAnswer: null,
  documentIds: [],
};

const validSearchFeedback = {
  query: "how to setup vitest",
  documentId: "doc-xyz-456",
  userId: 7,
  isRelevant: true,
  tenantId: "tenant-1",
};

const mockResponseRecord = {
  id: "feedback-uuid-1",
  ...validResponseFeedback,
  createdAt: new Date("2026-01-01"),
};

const mockSearchRecord = {
  id: "feedback-uuid-2",
  ...validSearchFeedback,
  createdAt: new Date("2026-01-01"),
};

describe("Feedback Service", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Default insert returning
    const mockInsertReturning = vi.fn().mockResolvedValue([mockResponseRecord]);
    mockInsertValues.mockReturnValue({ returning: mockInsertReturning });

    // Default select chain
    const mockSelectOrderBy = vi.fn().mockResolvedValue([]);
    const mockSelectWhere = vi.fn().mockReturnValue({ orderBy: mockSelectOrderBy });
    mockSelectFrom.mockReturnValue({ where: mockSelectWhere, orderBy: vi.fn().mockResolvedValue([]) });
    mockDbSelect.mockReturnValue({ from: mockSelectFrom });
  });

  // ─── submitResponseFeedback ────────────────────────────────────────────────

  describe("submitResponseFeedback", () => {
    it("inserts feedback and returns the record for positive rating", async () => {
      const mockInsertReturning = vi.fn().mockResolvedValue([mockResponseRecord]);
      mockInsertValues.mockReturnValue({ returning: mockInsertReturning });

      const result = await submitResponseFeedback(validResponseFeedback);

      expect(mockDbInsert).toHaveBeenCalled();
      expect(mockInsertValues).toHaveBeenCalledWith(
        expect.objectContaining({
          conversationId: "conv-abc-123",
          messageIndex: 2,
          userId: 7,
          rating: "positive",
        })
      );
      expect(result).toEqual(mockResponseRecord);
    });

    it("inserts feedback and returns the record for negative rating", async () => {
      const negativeFeedback = { ...validResponseFeedback, rating: "negative" as const };
      const mockRecord = { ...mockResponseRecord, rating: "negative" };
      const mockInsertReturning = vi.fn().mockResolvedValue([mockRecord]);
      mockInsertValues.mockReturnValue({ returning: mockInsertReturning });

      const result = await submitResponseFeedback(negativeFeedback);
      expect(result.rating).toBe("negative");
    });

    it("throws AppError 400 when rating is invalid", async () => {
      const invalidData = { ...validResponseFeedback, rating: "neutral" as any };

      await expect(submitResponseFeedback(invalidData)).rejects.toThrow(AppError);
      await expect(submitResponseFeedback(invalidData)).rejects.toMatchObject({
        statusCode: 400,
        message: "rating must be 'positive' or 'negative'",
      });
    });

    it("generates a UUID for the record id", async () => {
      const mockInsertReturning = vi.fn().mockResolvedValue([mockResponseRecord]);
      mockInsertValues.mockReturnValue({ returning: mockInsertReturning });

      await submitResponseFeedback(validResponseFeedback);

      const valuesArg = mockInsertValues.mock.calls[0][0];
      expect(valuesArg.id).toBeTruthy();
      expect(typeof valuesArg.id).toBe("string");
      expect(valuesArg.id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
      );
    });

    it("uses null for optional fields when not provided", async () => {
      const minimalFeedback = {
        conversationId: "conv-1",
        messageIndex: 0,
        userId: 1,
        rating: "positive" as const,
      };

      const mockInsertReturning = vi.fn().mockResolvedValue([mockResponseRecord]);
      mockInsertValues.mockReturnValue({ returning: mockInsertReturning });

      await submitResponseFeedback(minimalFeedback);

      const valuesArg = mockInsertValues.mock.calls[0][0];
      expect(valuesArg.feedbackText).toBeNull();
      expect(valuesArg.selectedText).toBeNull();
      expect(valuesArg.improvedAnswer).toBeNull();
      expect(valuesArg.qualityIssues).toEqual([]);
      expect(valuesArg.documentIds).toEqual([]);
    });

    it("does not insert when rating validation fails", async () => {
      const invalidData = { ...validResponseFeedback, rating: "" as any };

      await expect(submitResponseFeedback(invalidData)).rejects.toThrow();
      expect(mockDbInsert).not.toHaveBeenCalled();
    });
  });

  // ─── submitSearchFeedback ──────────────────────────────────────────────────

  describe("submitSearchFeedback", () => {
    it("inserts search feedback and returns the record", async () => {
      const mockInsertReturning = vi.fn().mockResolvedValue([mockSearchRecord]);
      mockInsertValues.mockReturnValue({ returning: mockInsertReturning });

      const result = await submitSearchFeedback(validSearchFeedback);

      expect(mockDbInsert).toHaveBeenCalled();
      expect(mockInsertValues).toHaveBeenCalledWith(
        expect.objectContaining({
          query: "how to setup vitest",
          documentId: "doc-xyz-456",
          userId: 7,
          isRelevant: true,
          tenantId: "tenant-1",
        })
      );
      expect(result).toEqual(mockSearchRecord);
    });

    it("generates a UUID for search feedback id", async () => {
      const mockInsertReturning = vi.fn().mockResolvedValue([mockSearchRecord]);
      mockInsertValues.mockReturnValue({ returning: mockInsertReturning });

      await submitSearchFeedback(validSearchFeedback);

      const valuesArg = mockInsertValues.mock.calls[0][0];
      expect(valuesArg.id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
      );
    });

    it("uses null for tenantId when not provided", async () => {
      const { tenantId, ...feedbackWithoutTenant } = validSearchFeedback;
      const mockInsertReturning = vi.fn().mockResolvedValue([mockSearchRecord]);
      mockInsertValues.mockReturnValue({ returning: mockInsertReturning });

      await submitSearchFeedback(feedbackWithoutTenant);

      const valuesArg = mockInsertValues.mock.calls[0][0];
      expect(valuesArg.tenantId).toBeNull();
    });

    it("correctly stores isRelevant=false", async () => {
      const irrelevantFeedback = { ...validSearchFeedback, isRelevant: false };
      const mockInsertReturning = vi.fn().mockResolvedValue([{ ...mockSearchRecord, isRelevant: false }]);
      mockInsertValues.mockReturnValue({ returning: mockInsertReturning });

      const result = await submitSearchFeedback(irrelevantFeedback);
      expect(result.isRelevant).toBe(false);
    });
  });

  // ─── getFeedbackForConversation ────────────────────────────────────────────

  describe("getFeedbackForConversation", () => {
    it("queries responseFeedback by conversationId", async () => {
      const feedbackItems = [mockResponseRecord];
      const mockSelectOrderBy = vi.fn().mockResolvedValue(feedbackItems);
      const mockSelectWhere = vi.fn().mockReturnValue({ orderBy: mockSelectOrderBy });
      mockSelectFrom.mockReturnValue({ where: mockSelectWhere });

      const result = await getFeedbackForConversation("conv-abc-123");

      expect(mockDbSelect).toHaveBeenCalled();
      expect(mockSelectFrom).toHaveBeenCalled();
      expect(mockSelectWhere).toHaveBeenCalled();
    });

    it("returns empty array when no feedback for conversation", async () => {
      const mockSelectOrderBy = vi.fn().mockResolvedValue([]);
      const mockSelectWhere = vi.fn().mockReturnValue({ orderBy: mockSelectOrderBy });
      mockSelectFrom.mockReturnValue({ where: mockSelectWhere });

      const result = await getFeedbackForConversation("conv-none");
      expect(result).toEqual([]);
    });

    it("returns all feedback items for the conversation", async () => {
      const items = [
        { ...mockResponseRecord, messageIndex: 0 },
        { ...mockResponseRecord, id: "feedback-2", messageIndex: 1 },
      ];
      const mockSelectOrderBy = vi.fn().mockResolvedValue(items);
      const mockSelectWhere = vi.fn().mockReturnValue({ orderBy: mockSelectOrderBy });
      mockSelectFrom.mockReturnValue({ where: mockSelectWhere });

      const result = await getFeedbackForConversation("conv-abc-123");
      expect(result).toHaveLength(2);
    });
  });

  // ─── getFeedbackStats ──────────────────────────────────────────────────────

  describe("getFeedbackStats", () => {
    it("returns stats structure with response and search feedback counts", async () => {
      // Multiple DB calls: totalRow, positiveRow, issueRows, searchTotalRow, searchRelevantRow
      mockSelectFrom
        .mockReturnValueOnce({
          where: vi.fn().mockResolvedValue([{ total: 100 }]),
        })
        .mockReturnValueOnce({
          where: vi.fn().mockResolvedValue([{ total: 75 }]),
        })
        .mockReturnValueOnce({
          where: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([]) }),
        })
        .mockReturnValueOnce({
          where: vi.fn().mockResolvedValue([{ total: 50 }]),
        })
        .mockReturnValueOnce({
          where: vi.fn().mockResolvedValue([{ total: 40 }]),
        });

      const result = await getFeedbackStats();

      expect(result).toHaveProperty("responseFeedback");
      expect(result).toHaveProperty("searchFeedback");
      expect(result).toHaveProperty("commonIssues");
    });

    it("calculates positiveRate correctly", async () => {
      mockSelectFrom
        .mockReturnValueOnce({ where: vi.fn().mockResolvedValue([{ total: 100 }]) })
        .mockReturnValueOnce({ where: vi.fn().mockResolvedValue([{ total: 75 }]) })
        .mockReturnValueOnce({ where: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([]) }) })
        .mockReturnValueOnce({ where: vi.fn().mockResolvedValue([{ total: 0 }]) })
        .mockReturnValueOnce({ where: vi.fn().mockResolvedValue([{ total: 0 }]) });

      const result = await getFeedbackStats();
      expect(result.responseFeedback.total).toBe(100);
      expect(result.responseFeedback.positive).toBe(75);
      expect(result.responseFeedback.negative).toBe(25);
      expect(result.responseFeedback.positiveRate).toBe(75);
    });

    it("returns zero positiveRate when total is 0", async () => {
      mockSelectFrom
        .mockReturnValueOnce({ where: vi.fn().mockResolvedValue([{ total: 0 }]) })
        .mockReturnValueOnce({ where: vi.fn().mockResolvedValue([{ total: 0 }]) })
        .mockReturnValueOnce({ where: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([]) }) })
        .mockReturnValueOnce({ where: vi.fn().mockResolvedValue([{ total: 0 }]) })
        .mockReturnValueOnce({ where: vi.fn().mockResolvedValue([{ total: 0 }]) });

      const result = await getFeedbackStats();
      expect(result.responseFeedback.positiveRate).toBe(0);
    });

    it("aggregates quality issues from negative feedback", async () => {
      const issueRows = [
        { issues: ["hallucination", "off-topic"] },
        { issues: ["hallucination"] },
        { issues: ["off-topic", "too-long"] },
      ];

      mockSelectFrom
        .mockReturnValueOnce({ where: vi.fn().mockResolvedValue([{ total: 3 }]) })
        .mockReturnValueOnce({ where: vi.fn().mockResolvedValue([{ total: 0 }]) })
        .mockReturnValueOnce({ where: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue(issueRows) }) })
        .mockReturnValueOnce({ where: vi.fn().mockResolvedValue([{ total: 0 }]) })
        .mockReturnValueOnce({ where: vi.fn().mockResolvedValue([{ total: 0 }]) });

      const result = await getFeedbackStats();
      expect(result.commonIssues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ issue: "hallucination", occurrences: 2 }),
          expect.objectContaining({ issue: "off-topic", occurrences: 2 }),
        ])
      );
    });
  });

  // ─── exportFeedback ────────────────────────────────────────────────────────

  describe("exportFeedback", () => {
    const setupExportMocks = (responseRows: unknown[], searchRows: unknown[]) => {
      // exportFeedback calls:
      // 1. select().from(responseFeedback).orderBy(...)
      // 2. select().from(searchFeedback).where(...).orderBy(...)
      mockSelectFrom
        .mockReturnValueOnce({
          where: vi.fn().mockReturnValue({ orderBy: vi.fn().mockResolvedValue(responseRows) }),
          orderBy: vi.fn().mockResolvedValue(responseRows),
        })
        .mockReturnValueOnce({
          where: vi.fn().mockReturnValue({ orderBy: vi.fn().mockResolvedValue(searchRows) }),
          orderBy: vi.fn().mockResolvedValue(searchRows),
        });
    };

    it("returns JSON string with exportedAt when format=json", async () => {
      setupExportMocks([mockResponseRecord], [mockSearchRecord]);

      const result = await exportFeedback(undefined, "json");

      expect(typeof result).toBe("string");
      const parsed = JSON.parse(result);
      expect(parsed).toHaveProperty("exportedAt");
      expect(parsed).toHaveProperty("responseFeedback");
      expect(parsed).toHaveProperty("searchFeedback");
    });

    it("JSON export includes both response and search feedback arrays", async () => {
      setupExportMocks([mockResponseRecord], [mockSearchRecord]);

      const result = await exportFeedback(undefined, "json");
      const parsed = JSON.parse(result);

      expect(Array.isArray(parsed.responseFeedback)).toBe(true);
      expect(Array.isArray(parsed.searchFeedback)).toBe(true);
      expect(parsed.responseFeedback).toHaveLength(1);
      expect(parsed.searchFeedback).toHaveLength(1);
    });

    it("JSON exportedAt is an ISO date string", async () => {
      setupExportMocks([], []);

      const result = await exportFeedback(undefined, "json");
      const parsed = JSON.parse(result);

      expect(parsed.exportedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    });

    it("returns CSV string with headers when format=csv", async () => {
      setupExportMocks([mockResponseRecord], []);

      const result = await exportFeedback(undefined, "csv");

      expect(typeof result).toBe("string");
      const firstLine = result.split("\n")[0];
      expect(firstLine).toContain("id");
      expect(firstLine).toContain("conversationId");
      expect(firstLine).toContain("rating");
      expect(firstLine).toContain("userId");
    });

    it("CSV export includes headers-only line when no records", async () => {
      setupExportMocks([], []);

      const result = await exportFeedback(undefined, "csv");
      const lines = result.split("\n");
      expect(lines).toHaveLength(1);
      expect(lines[0]).toContain("id,conversationId");
    });

    it("CSV export has one data row per response feedback record", async () => {
      const twoRecords = [
        { ...mockResponseRecord, id: "r1" },
        { ...mockResponseRecord, id: "r2", messageIndex: 3 },
      ];
      setupExportMocks(twoRecords, []);

      const result = await exportFeedback(undefined, "csv");
      const lines = result.split("\n");
      // 1 header + 2 data rows
      expect(lines).toHaveLength(3);
    });

    it("CSV escapes double quotes in text fields", async () => {
      const recordWithQuotes = {
        ...mockResponseRecord,
        feedbackText: 'He said "good job"',
      };
      setupExportMocks([recordWithQuotes], []);

      const result = await exportFeedback(undefined, "csv");
      // Escaped double quote: "" inside CSV field
      expect(result).toContain('""good job""');
    });

    it("CSV includes correct column order", async () => {
      setupExportMocks([mockResponseRecord], []);

      const result = await exportFeedback(undefined, "csv");
      const headers = result.split("\n")[0].split(",");
      expect(headers[0]).toBe("id");
      expect(headers[1]).toBe("conversationId");
      expect(headers[2]).toBe("messageIndex");
      expect(headers[3]).toBe("userId");
      expect(headers[4]).toBe("rating");
    });
  });
});
