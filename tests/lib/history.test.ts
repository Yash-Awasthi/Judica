import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock drizzle
vi.mock("../../src/lib/drizzle.js", () => {
  const createQueryMock = () => ({
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    then: vi.fn(function(resolve) {
      return Promise.resolve(this._results || []).then(resolve);
    }),
    _results: [] as any[]
  });

  return {
    db: {
      select: vi.fn(() => createQueryMock()),
      insert: vi.fn(() => ({ values: vi.fn().mockResolvedValue({}) })),
    }
  };
});

vi.mock("../../src/router/tokenEstimator.js", () => ({
  estimateStringTokens: vi.fn(() => 10),
}));

vi.mock("../../src/db/schema/conversations.js", () => ({
  chats: { conversationId: "conversationId", createdAt: "createdAt", question: "question", verdict: "verdict", opinions: "opinions", userId: "userId" },
  contextSummaries: { conversationId: "conversationId", createdAt: "createdAt", summary: "summary", messageCount: "messageCount" },
}));

vi.mock("drizzle-orm", async (importOriginal) => {
  const actual = await importOriginal() as any;
  return {
    ...actual,
    eq: vi.fn(),
    desc: vi.fn(),
    asc: vi.fn(),
    and: vi.fn(),
  };
});

describe("History Utility", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("getRecentHistory", () => {
    it("should return formatted messages from recent chats", async () => {
      const { getRecentHistory } = await import("../../src/lib/history.js");
      const { db } = await import("../../src/lib/drizzle.js");
      
      const mockChats = [
        { question: "Q2", verdict: "A2" },
        { question: "Q1", verdict: "A1" }
      ];
      
      const query = (db.select() as any);
      query._results = [...mockChats];
      vi.mocked(db.select).mockReturnValueOnce(query);

      const result = await getRecentHistory("conv1");
      expect(result[0].content).toBe("Q1");
    });
  });

  describe("getHistoryWithContext", () => {
    it("should include context summary in messages", async () => {
      const { getHistoryWithContext } = await import("../../src/lib/history.js");
      const { db } = await import("../../src/lib/drizzle.js");

      const q1 = (db.select() as any);
      q1._results = [{ summary: "The story so far", messageCount: 10 }];
      const q2 = (db.select() as any);
      q2._results = [{ question: "Q1", verdict: "A1" }];

      vi.mocked(db.select).mockReturnValueOnce(q1).mockReturnValueOnce(q2);

      const result = await getHistoryWithContext("conv1");
      expect(result[0].content).toContain("The story so far");
    });
  });

  describe("getEnhancedContext", () => {
    it("should return messages and relevant context", async () => {
      const { getEnhancedContext } = await import("../../src/lib/history.js");
      const { db } = await import("../../src/lib/drizzle.js");

      const q1 = (db.select() as any); q1._results = [{ question: "Q1", verdict: "A1" }];
      const q2 = (db.select() as any); q2._results = [{ summary: "Important topic about intelligence" }];
      const q3 = (db.select() as any); q3._results = [{ question: "AI question", verdict: "AI verdict", opinions: [] }];

      vi.mocked(db.select).mockReturnValueOnce(q1).mockReturnValueOnce(q2).mockReturnValueOnce(q3);

      const result = await getEnhancedContext("conv1", "Tell me about intelligence");
      expect(result.contextSummary).toContain("Important topic about intelligence");
    });
  });

  describe("updateEnhancedContextSummary", () => {
    it("should insert a new summary if conversation is long enough", async () => {
      const { updateEnhancedContextSummary } = await import("../../src/lib/history.js");
      const { db } = await import("../../src/lib/drizzle.js");

      const manyChats = Array(10).fill({ question: "Q", verdict: "A" });
      const q = (db.select() as any); q._results = manyChats;
      vi.mocked(db.select).mockReturnValueOnce(q);

      await updateEnhancedContextSummary("conv1");
      expect(db.insert).toHaveBeenCalled();
    });

    it("should skip if conversation is short", async () => {
        const { updateEnhancedContextSummary } = await import("../../src/lib/history.js");
        const { db } = await import("../../src/lib/drizzle.js");
  
        const fewChats = Array(5).fill({ question: "Q", verdict: "A" });
        (db.select() as any).then.mockResolvedValue(fewChats);
  
        await updateEnhancedContextSummary("conv1");
        expect(db.insert).not.toHaveBeenCalled();
    });
  });
});
