vi.mock("../../src/lib/logger.js", () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() })),
  },
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((a, b) => ({ eq: true, a, b })),
  desc: vi.fn((col) => ({ desc: true, col })),
  count: vi.fn(() => "count(*)"),
}));

vi.mock("../../src/db/schema/conversations.js", () => ({
  conversations: { id: "id", sessionSummary: "sessionSummary", updatedAt: "updatedAt" },
  chats: { conversationId: "conversationId", question: "question", verdict: "verdict", createdAt: "createdAt" },
}));

const { mockRouteAndCollect } = vi.hoisted(() => ({
  mockRouteAndCollect: vi.fn().mockResolvedValue({ text: "Summary bullet points" }),
}));

vi.mock("../../src/router/index.js", () => ({
  routeAndCollect: mockRouteAndCollect,
}));

// ─── Hoisted DB mocks ─────────────────────────────────────────────────────────
const {
  mockDbSelect,
  mockDbUpdate,
  mockSelectFrom,
  mockUpdateSet,
} = vi.hoisted(() => {
  const mockUpdateWhere = vi.fn().mockResolvedValue(undefined);
  const mockUpdateSet = vi.fn().mockReturnValue({ where: mockUpdateWhere });
  const mockDbUpdate = vi.fn().mockReturnValue({ set: mockUpdateSet });

  const mockSelectLimit = vi.fn().mockResolvedValue([]);
  const mockSelectOrderBy = vi.fn().mockResolvedValue([]);
  const mockSelectWhere = vi.fn().mockReturnValue({
    limit: mockSelectLimit,
    orderBy: vi.fn().mockReturnValue({ limit: mockSelectLimit }),
  });
  const mockSelectFrom = vi.fn().mockReturnValue({ where: mockSelectWhere });
  const mockDbSelect = vi.fn().mockReturnValue({ from: mockSelectFrom });

  return { mockDbSelect, mockDbUpdate, mockSelectFrom, mockUpdateSet };
});

vi.mock("../../src/lib/drizzle.js", () => ({
  db: { select: mockDbSelect, update: mockDbUpdate },
}));

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  buildLayeredContext,
  autoSummarize,
  summarizeSession,
} from "../../src/services/sessionSummary.service.js";

describe("SessionSummary Service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset OneTime queue AND default so leftover values don't bleed into next test
    mockSelectFrom.mockReset();
    mockDbSelect.mockReset();
    mockDbUpdate.mockReset();
    mockDbSelect.mockReturnValue({ from: mockSelectFrom });
    mockDbUpdate.mockReturnValue({ set: mockUpdateSet });

    mockRouteAndCollect.mockResolvedValue({ text: "• Point 1\n• Point 2\n• Point 3" });

    const mockUpdateWhere = vi.fn().mockResolvedValue(undefined);
    mockUpdateSet.mockReturnValue({ where: mockUpdateWhere });

    const mockSelectLimit = vi.fn().mockResolvedValue([]);
    const mockSelectOrderByLimit = vi.fn().mockResolvedValue([]);
    const mockSelectOrderBy = vi.fn().mockReturnValue({ limit: mockSelectOrderByLimit });
    mockSelectFrom.mockReturnValue({
      where: vi.fn().mockReturnValue({
        orderBy: mockSelectOrderBy,
        limit: mockSelectLimit,
      }),
    });
  });

  // ─── buildLayeredContext ──────────────────────────────────────────────────

  describe("buildLayeredContext", () => {
    it("returns empty string when no session summary and no rag chunks", () => {
      const result = buildLayeredContext(null, [], []);
      expect(result).toBe("");
    });

    it("wraps session summary in SESSION SUMMARY tags", () => {
      const result = buildLayeredContext("Key decisions were made.", [], []);
      expect(result).toContain("[SESSION SUMMARY]");
      expect(result).toContain("Key decisions were made.");
      expect(result).toContain("[/SESSION SUMMARY]");
    });

    it("wraps rag chunks in RETRIEVED MEMORY tags", () => {
      const result = buildLayeredContext(null, [], ["Chunk 1", "Chunk 2"]);
      expect(result).toContain("[RETRIEVED MEMORY]");
      expect(result).toContain("Chunk 1");
      expect(result).toContain("[/RETRIEVED MEMORY]");
    });

    it("includes both session summary and rag chunks separated by double newline", () => {
      const result = buildLayeredContext("Summary here", [], ["Chunk A"]);
      expect(result).toContain("[SESSION SUMMARY]");
      expect(result).toContain("[RETRIEVED MEMORY]");
      expect(result.indexOf("[SESSION SUMMARY]")).toBeLessThan(result.indexOf("[RETRIEVED MEMORY]"));
    });

    it("caps rag chunks at 20", () => {
      const manyChunks = Array.from({ length: 25 }, (_, i) => `Chunk ${i}`);
      const result = buildLayeredContext(null, [], manyChunks);
      // Only first 20 chunks included — chunk 20 should NOT be there
      expect(result).not.toContain("Chunk 20");
      expect(result).toContain("Chunk 19");
    });

    it("truncates each rag chunk at 2000 chars", () => {
      const longChunk = "x".repeat(3000);
      const result = buildLayeredContext(null, [], [longChunk]);
      // The chunk should be truncated to 2000 chars in the output
      expect(result.length).toBeLessThan(3000 + 200); // accounting for tags
    });

    it("does not include RETRIEVED MEMORY section when chunks are empty", () => {
      const result = buildLayeredContext("Summary", [], []);
      expect(result).not.toContain("[RETRIEVED MEMORY]");
    });

    it("ignores recentMessages parameter (handled by caller)", () => {
      const result = buildLayeredContext(null, [{ role: "user", content: "Hello" }], []);
      expect(result).toBe("");
    });
  });

  // ─── summarizeSession ────────────────────────────────────────────────────

  describe("summarizeSession", () => {
    it("returns empty string when fewer than 5 messages", async () => {
      const mockLimit = vi.fn().mockResolvedValue([{ question: "Q", verdict: "A" }]);
      const mockOrderBy = vi.fn().mockReturnValue({ limit: mockLimit });
      mockSelectFrom.mockReturnValueOnce({ where: vi.fn().mockReturnValue({ orderBy: mockOrderBy }) });

      const result = await summarizeSession("conv-1", 1);
      expect(result).toBe("");
    });

    it("calls routeAndCollect with transcript when 5+ messages", async () => {
      const messages = Array.from({ length: 5 }, (_, i) => ({ question: `Q${i}`, verdict: `A${i}` }));
      const mockLimit = vi.fn().mockResolvedValue(messages);
      const mockOrderBy = vi.fn().mockReturnValue({ limit: mockLimit });
      mockSelectFrom.mockReturnValueOnce({ where: vi.fn().mockReturnValue({ orderBy: mockOrderBy }) });
      // Update conversation mock
      mockSelectFrom.mockReturnValueOnce({ set: vi.fn() });

      const result = await summarizeSession("conv-1", 1);

      expect(mockRouteAndCollect).toHaveBeenCalledWith(
        expect.objectContaining({ model: "auto", temperature: 0 })
      );
      expect(result).toBe("• Point 1\n• Point 2\n• Point 3");
    });

    it("truncates message content to 500 chars in transcript", async () => {
      const longQ = "A".repeat(600);
      const messages = Array.from({ length: 5 }, () => ({ question: longQ, verdict: "short" }));
      const mockLimit = vi.fn().mockResolvedValue(messages);
      const mockOrderBy = vi.fn().mockReturnValue({ limit: mockLimit });
      mockSelectFrom.mockReturnValueOnce({ where: vi.fn().mockReturnValue({ orderBy: mockOrderBy }) });

      await summarizeSession("conv-1", 1);

      const callArg = mockRouteAndCollect.mock.calls[0][0];
      const content = callArg.messages[0].content;
      // 500 char limit on each message prevents the full 600A string
      expect(content).not.toContain("A".repeat(501));
    });

    it("stores summary back to conversations table", async () => {
      const messages = Array.from({ length: 6 }, (_, i) => ({ question: `Q${i}`, verdict: `A${i}` }));
      const mockLimit = vi.fn().mockResolvedValue(messages);
      const mockOrderBy = vi.fn().mockReturnValue({ limit: mockLimit });
      mockSelectFrom.mockReturnValueOnce({ where: vi.fn().mockReturnValue({ orderBy: mockOrderBy }) });

      await summarizeSession("conv-1", 1);

      expect(mockDbUpdate).toHaveBeenCalled();
      expect(mockUpdateSet).toHaveBeenCalledWith(
        expect.objectContaining({ sessionSummary: "• Point 1\n• Point 2\n• Point 3" })
      );
    });
  });

  // ─── autoSummarize ───────────────────────────────────────────────────────

  describe("autoSummarize", () => {
    it("does NOT call summarizeSession when chatCount <= 30", async () => {
      // count query returns 10
      const mockFrom = vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([{ value: 10 }]),
      });
      mockDbSelect.mockReturnValueOnce({ from: mockFrom });

      await autoSummarize("conv-1", 1);

      expect(mockRouteAndCollect).not.toHaveBeenCalled();
    });

    it("does NOT call summarizeSession when chatCount > 30 but summary exists and is recent", async () => {
      // count query returns 35
      const mockFromCount = vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([{ value: 35 }]),
      });
      mockDbSelect.mockReturnValueOnce({ from: mockFromCount });

      // conversation select returns recent summary
      const recentDate = new Date(); // just now
      const mockLimit = vi.fn().mockResolvedValue([{ sessionSummary: "Existing summary", updatedAt: recentDate }]);
      mockSelectFrom.mockReturnValueOnce({ where: vi.fn().mockReturnValue({ limit: mockLimit }) });

      await autoSummarize("conv-1", 1);

      expect(mockRouteAndCollect).not.toHaveBeenCalled();
    });

    it("calls summarizeSession when chatCount > 30 and no summary exists", async () => {
      // count query returns 35
      const mockFromCount = vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([{ value: 35 }]),
      });
      mockDbSelect.mockReturnValueOnce({ from: mockFromCount });

      // conversation has no summary
      const mockLimit = vi.fn().mockResolvedValue([{ sessionSummary: null, updatedAt: new Date() }]);
      mockSelectFrom.mockReturnValueOnce({ where: vi.fn().mockReturnValue({ limit: mockLimit }) });

      // messages for summarization (5 messages)
      const messages = Array.from({ length: 5 }, (_, i) => ({ question: `Q${i}`, verdict: `A${i}` }));
      const mockLimit2 = vi.fn().mockResolvedValue(messages);
      const mockOrderBy = vi.fn().mockReturnValue({ limit: mockLimit2 });
      mockSelectFrom.mockReturnValueOnce({ where: vi.fn().mockReturnValue({ orderBy: mockOrderBy }) });

      await autoSummarize("conv-1", 1);

      expect(mockRouteAndCollect).toHaveBeenCalled();
    });

    it("calls summarizeSession when chatCount > 30 and summary is older than 1 hour", async () => {
      // count returns 35
      const mockFromCount = vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([{ value: 35 }]),
      });
      mockDbSelect.mockReturnValueOnce({ from: mockFromCount });

      // conversation has OLD summary
      const oldDate = new Date(Date.now() - 2 * 60 * 60 * 1000); // 2 hours ago
      const mockLimit = vi.fn().mockResolvedValue([{ sessionSummary: "Old summary", updatedAt: oldDate }]);
      mockSelectFrom.mockReturnValueOnce({ where: vi.fn().mockReturnValue({ limit: mockLimit }) });

      // messages for summarization
      const messages = Array.from({ length: 5 }, (_, i) => ({ question: `Q${i}`, verdict: `A${i}` }));
      const mockLimit2 = vi.fn().mockResolvedValue(messages);
      const mockOrderBy = vi.fn().mockReturnValue({ limit: mockLimit2 });
      mockSelectFrom.mockReturnValueOnce({ where: vi.fn().mockReturnValue({ orderBy: mockOrderBy }) });

      await autoSummarize("conv-1", 1);

      expect(mockRouteAndCollect).toHaveBeenCalled();
    });
  });
});
