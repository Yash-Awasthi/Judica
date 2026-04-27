vi.mock("../../src/lib/standardAnswers/index.js", () => ({
  findBestStandardAnswer: vi.fn().mockReturnValue(null),
  DEFAULT_STANDARD_ANSWER_CONFIG: { threshold: 0.8 },
}));

vi.mock("../../src/lib/standardAnswers/models.js", () => ({}));

vi.mock("../../src/db/schema/standardAnswers.js", () => ({
  standardAnswers: { id: "id", priority: "priority" },
  standardAnswerRules: { answerId: "answerId" },
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

// ─── Hoisted DB mocks ─────────────────────────────────────────────────────────
const {
  mockDbSelect,
  mockDbInsert,
  mockDbUpdate,
  mockDbDelete,
  mockSelectFrom,
  mockInsertValues,
  mockUpdateSet,
  mockDeleteWhere,
} = vi.hoisted(() => {
  const mockDeleteWhere = vi.fn().mockResolvedValue([]);
  const mockDbDelete = vi.fn().mockReturnValue({ where: mockDeleteWhere });

  const mockInsertValues = vi.fn().mockResolvedValue(undefined);
  const mockDbInsert = vi.fn().mockReturnValue({ values: mockInsertValues });

  const mockUpdateWhere = vi.fn().mockResolvedValue(undefined);
  const mockUpdateSet = vi.fn().mockReturnValue({ where: mockUpdateWhere });
  const mockDbUpdate = vi.fn().mockReturnValue({ set: mockUpdateSet });

  const mockSelectOrderBy = vi.fn().mockResolvedValue([]);
  const mockSelectWhere = vi.fn().mockReturnValue({ orderBy: mockSelectOrderBy });
  const mockSelectFrom = vi.fn().mockReturnValue({
    where: mockSelectWhere,
    orderBy: mockSelectOrderBy,
  });
  const mockDbSelect = vi.fn().mockReturnValue({ from: mockSelectFrom });

  return {
    mockDbSelect,
    mockDbInsert,
    mockDbUpdate,
    mockDbDelete,
    mockSelectFrom,
    mockInsertValues,
    mockUpdateSet,
    mockDeleteWhere,
  };
});

vi.mock("../../src/lib/drizzle.js", () => ({
  db: {
    select: mockDbSelect,
    insert: mockDbInsert,
    update: mockDbUpdate,
    delete: mockDbDelete,
  },
}));

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  createStandardAnswer,
  listStandardAnswers,
  deleteStandardAnswer,
  updateStandardAnswer,
  matchQuery,
} from "../../src/services/standardAnswer.service.js";
import { findBestStandardAnswer } from "../../src/lib/standardAnswers/index.js";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const validAnswerData = {
  title: "What is AI?",
  answer: "Artificial Intelligence is the simulation of human intelligence processes by machines.",
  categories: ["general", "ai"],
  priority: 1,
  rules: [
    { type: "keyword" as const, value: "artificial intelligence", threshold: 0.8 },
    { type: "semantic" as const, value: "what is AI", threshold: 0.75, matchAll: false },
  ],
};

const mockAnswer = {
  id: "answer-uuid-1",
  title: "What is AI?",
  answer: "Artificial Intelligence is...",
  enabled: true,
  categories: ["general"],
  priority: 1,
  createdBy: 5,
  createdAt: new Date("2026-01-01"),
  updatedAt: new Date("2026-01-01"),
};

const mockRule = {
  id: "rule-uuid-1",
  answerId: "answer-uuid-1",
  type: "keyword",
  value: "artificial intelligence",
  threshold: 80,
  matchAll: false,
};

describe("StandardAnswer Service", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Default insert: returns undefined (no .returning() used)
    mockInsertValues.mockResolvedValue(undefined);

    // Default select chain
    const mockSelectOrderBy = vi.fn().mockResolvedValue([]);
    mockSelectFrom.mockReturnValue({
      where: vi.fn().mockReturnValue({ orderBy: mockSelectOrderBy }),
      orderBy: mockSelectOrderBy,
    });
    mockDbSelect.mockReturnValue({ from: mockSelectFrom });

    // Default update
    const mockUpdateWhere = vi.fn().mockResolvedValue(undefined);
    mockUpdateSet.mockReturnValue({ where: mockUpdateWhere });

    // Default delete
    mockDeleteWhere.mockResolvedValue([]);

    // Reset findBestStandardAnswer
    vi.mocked(findBestStandardAnswer).mockReturnValue(null);
  });

  // ─── createStandardAnswer ──────────────────────────────────────────────────

  describe("createStandardAnswer", () => {
    it("inserts into standardAnswers and returns an id", async () => {
      const result = await createStandardAnswer(validAnswerData, 5);

      expect(mockDbInsert).toHaveBeenCalled();
      expect(result).toHaveProperty("id");
      expect(typeof result.id).toBe("string");
    });

    it("generates a UUID for the answer id", async () => {
      const result = await createStandardAnswer(validAnswerData, 5);

      expect(result.id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
      );
    });

    it("inserts answer with correct fields including createdBy and priority", async () => {
      await createStandardAnswer(validAnswerData, 42);

      // First insert call is standardAnswers
      const firstInsertCall = mockInsertValues.mock.calls[0][0];
      expect(firstInsertCall).toMatchObject({
        title: "What is AI?",
        answer: "Artificial Intelligence is the simulation of human intelligence processes by machines.",
        priority: 1,
        createdBy: 42,
      });
    });

    it("inserts rules into standardAnswerRules with threshold converted to int percent", async () => {
      await createStandardAnswer(validAnswerData, 5);

      // Second insert call is rules
      const rulesInsertCall = mockInsertValues.mock.calls[1][0];
      expect(Array.isArray(rulesInsertCall)).toBe(true);
      expect(rulesInsertCall[0]).toMatchObject({
        type: "keyword",
        value: "artificial intelligence",
        threshold: 80, // 0.8 * 100
      });
    });

    it("converts threshold 0.75 to 75 for rules", async () => {
      await createStandardAnswer(validAnswerData, 5);

      const rulesInsertCall = mockInsertValues.mock.calls[1][0];
      expect(rulesInsertCall[1]).toMatchObject({
        type: "semantic",
        threshold: 75, // 0.75 * 100
      });
    });

    it("defaults threshold to 0.8 (80) when not provided in rule", async () => {
      const dataWithoutThreshold = {
        ...validAnswerData,
        rules: [{ type: "keyword" as const, value: "test" }],
      };

      await createStandardAnswer(dataWithoutThreshold, 5);

      const rulesInsertCall = mockInsertValues.mock.calls[1][0];
      expect(rulesInsertCall[0].threshold).toBe(80);
    });

    it("skips rules insert when rules array is empty", async () => {
      const dataNoRules = { ...validAnswerData, rules: [] };

      await createStandardAnswer(dataNoRules, 5);

      // Only one insert call (for the answer), not two
      expect(mockDbInsert).toHaveBeenCalledTimes(1);
    });

    it("uses empty array for categories when not provided", async () => {
      const dataNoCategories = { ...validAnswerData, categories: undefined };

      await createStandardAnswer(dataNoCategories, 5);

      const firstInsertCall = mockInsertValues.mock.calls[0][0];
      expect(firstInsertCall.categories).toEqual([]);
    });

    it("defaults priority to 0 when not provided", async () => {
      const dataNoP = { ...validAnswerData, priority: undefined };

      await createStandardAnswer(dataNoP, 5);

      const firstInsertCall = mockInsertValues.mock.calls[0][0];
      expect(firstInsertCall.priority).toBe(0);
    });
  });

  // ─── listStandardAnswers ───────────────────────────────────────────────────

  describe("listStandardAnswers", () => {
    it("returns all answers with their rules joined", async () => {
      const mockOrderBy = vi.fn().mockResolvedValue([mockAnswer]);
      mockSelectFrom.mockReturnValueOnce({ orderBy: mockOrderBy });
      // Second select for rules
      mockSelectFrom.mockResolvedValueOnce([mockRule]);

      const result = await listStandardAnswers();

      expect(Array.isArray(result)).toBe(true);
      expect(result).toHaveLength(1);
      expect(result[0]).toHaveProperty("id");
      expect(result[0]).toHaveProperty("rules");
    });

    it("converts rule threshold from int percent back to decimal", async () => {
      const mockOrderBy = vi.fn().mockResolvedValue([mockAnswer]);
      mockSelectFrom.mockReturnValueOnce({ orderBy: mockOrderBy });
      // Rules with threshold 80 → should become 0.8
      mockSelectFrom.mockResolvedValueOnce([mockRule]);

      const result = await listStandardAnswers();

      expect(result[0].rules[0].threshold).toBe(0.8); // 80 / 100
    });

    it("returns empty rules array when answer has no rules", async () => {
      const mockOrderBy = vi.fn().mockResolvedValue([mockAnswer]);
      mockSelectFrom.mockReturnValueOnce({ orderBy: mockOrderBy });
      // No rules in DB
      mockSelectFrom.mockResolvedValueOnce([]);

      const result = await listStandardAnswers();

      expect(result[0].rules).toEqual([]);
    });

    it("returns empty array when no answers exist", async () => {
      const mockOrderBy = vi.fn().mockResolvedValue([]);
      mockSelectFrom.mockReturnValueOnce({ orderBy: mockOrderBy });
      mockSelectFrom.mockResolvedValueOnce([]);

      const result = await listStandardAnswers();
      expect(result).toEqual([]);
    });

    it("maps answer fields correctly including categories and enabled", async () => {
      const answerWithCategories = { ...mockAnswer, categories: ["faq", "technical"], enabled: false };
      const mockOrderBy = vi.fn().mockResolvedValue([answerWithCategories]);
      mockSelectFrom.mockReturnValueOnce({ orderBy: mockOrderBy });
      mockSelectFrom.mockResolvedValueOnce([]);

      const result = await listStandardAnswers();

      expect(result[0].categories).toEqual(["faq", "technical"]);
      expect(result[0].enabled).toBe(false);
    });
  });

  // ─── deleteStandardAnswer ──────────────────────────────────────────────────

  describe("deleteStandardAnswer", () => {
    it("calls delete with the correct id", async () => {
      mockDeleteWhere.mockResolvedValue([]);

      await deleteStandardAnswer("answer-uuid-1");

      expect(mockDbDelete).toHaveBeenCalled();
      expect(mockDeleteWhere).toHaveBeenCalled();
    });

    it("does not throw when answer does not exist", async () => {
      mockDeleteWhere.mockResolvedValue([]);

      await expect(deleteStandardAnswer("nonexistent-id")).resolves.toBeUndefined();
    });
  });

  // ─── updateStandardAnswer ──────────────────────────────────────────────────

  describe("updateStandardAnswer", () => {
    it("calls update with the correct id condition", async () => {
      const mockUpdateWhere = vi.fn().mockResolvedValue(undefined);
      mockUpdateSet.mockReturnValue({ where: mockUpdateWhere });

      await updateStandardAnswer("answer-uuid-1", { title: "Updated Title" });

      expect(mockDbUpdate).toHaveBeenCalled();
      expect(mockUpdateSet).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Updated Title" })
      );
      expect(mockUpdateWhere).toHaveBeenCalled();
    });

    it("sets updatedAt to current time", async () => {
      const before = new Date();
      const mockUpdateWhere = vi.fn().mockResolvedValue(undefined);
      mockUpdateSet.mockReturnValue({ where: mockUpdateWhere });

      await updateStandardAnswer("answer-uuid-1", { enabled: false });

      const setArg = mockUpdateSet.mock.calls[0][0];
      expect(setArg.updatedAt).toBeInstanceOf(Date);
      expect(setArg.updatedAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
    });

    it("spreads provided data fields into update payload", async () => {
      const mockUpdateWhere = vi.fn().mockResolvedValue(undefined);
      mockUpdateSet.mockReturnValue({ where: mockUpdateWhere });

      await updateStandardAnswer("answer-uuid-1", {
        title: "New Title",
        enabled: true,
        categories: ["updated"],
        priority: 5,
      });

      expect(mockUpdateSet).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "New Title",
          enabled: true,
          categories: ["updated"],
          priority: 5,
        })
      );
    });

    it("resolves without error even on partial updates", async () => {
      const mockUpdateWhere = vi.fn().mockResolvedValue(undefined);
      mockUpdateSet.mockReturnValue({ where: mockUpdateWhere });

      await expect(updateStandardAnswer("answer-uuid-1", { enabled: false })).resolves.toBeUndefined();
    });
  });

  // ─── matchQuery ────────────────────────────────────────────────────────────

  describe("matchQuery", () => {
    it("returns null when no matching answer found", async () => {
      // listStandardAnswers: answers + rules
      const mockOrderBy = vi.fn().mockResolvedValue([]);
      mockSelectFrom.mockReturnValueOnce({ orderBy: mockOrderBy });
      mockSelectFrom.mockResolvedValueOnce([]);

      vi.mocked(findBestStandardAnswer).mockReturnValue(null);

      const result = await matchQuery("some query");
      expect(result).toBeNull();
    });

    it("calls findBestStandardAnswer with the query and loaded answers", async () => {
      // listStandardAnswers
      const mockOrderBy = vi.fn().mockResolvedValue([mockAnswer]);
      mockSelectFrom.mockReturnValueOnce({ orderBy: mockOrderBy });
      mockSelectFrom.mockResolvedValueOnce([]);

      await matchQuery("what is AI");

      expect(findBestStandardAnswer).toHaveBeenCalledWith(
        "what is AI",
        expect.any(Array),
        expect.objectContaining({ threshold: 0.8 })
      );
    });

    it("returns match result when findBestStandardAnswer finds a match", async () => {
      const mockMatch = {
        answer: mockAnswer as any,
        score: 0.95,
        matchedRule: { id: "r1", type: "semantic", value: "what is AI", threshold: 0.75, matchAll: false },
      };

      // listStandardAnswers
      const mockOrderBy = vi.fn().mockResolvedValue([mockAnswer]);
      mockSelectFrom.mockReturnValueOnce({ orderBy: mockOrderBy });
      mockSelectFrom.mockResolvedValueOnce([]);

      vi.mocked(findBestStandardAnswer).mockReturnValue(mockMatch as any);

      const result = await matchQuery("what is AI");
      expect(result).toEqual(mockMatch);
    });

    it("uses provided config instead of DEFAULT_STANDARD_ANSWER_CONFIG", async () => {
      // listStandardAnswers
      const mockOrderBy = vi.fn().mockResolvedValue([]);
      mockSelectFrom.mockReturnValueOnce({ orderBy: mockOrderBy });
      mockSelectFrom.mockResolvedValueOnce([]);

      const customConfig = { threshold: 0.95 };
      await matchQuery("test query", customConfig as any);

      expect(findBestStandardAnswer).toHaveBeenCalledWith(
        "test query",
        expect.any(Array),
        customConfig
      );
    });
  });
});
