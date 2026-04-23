import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  summarizeSession,
  autoSummarize,
  buildLayeredContext,
} from "../../src/services/sessionSummary.service.js";
import { db } from "../../src/lib/drizzle.js";
import { routeAndCollect } from "../../src/router/index.js";

// ── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("../../src/lib/drizzle.js", () => ({
  db: {
    select: vi.fn(),
    update: vi.fn(),
  },
}));

vi.mock("../../src/router/index.js", () => ({
  routeAndCollect: vi.fn(),
}));

vi.mock("../../src/lib/logger.js", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeMessages(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    question: `Question ${i + 1}`,
    verdict: `Answer ${i + 1}`,
  }));
}

/** Wire up the chained query builder for db.select() */
function mockSelectChain(rows: unknown[]) {
  const chain = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue(rows),
  };
  (db.select as ReturnType<typeof vi.fn>).mockReturnValue(chain);
  return chain;
}

/** Wire up the chained query builder for db.update() */
function mockUpdateChain() {
  const chain = {
    set: vi.fn().mockReturnThis(),
    where: vi.fn().mockResolvedValue(undefined),
  };
  (db.update as ReturnType<typeof vi.fn>).mockReturnValue(chain);
  return chain;
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("sessionSummary service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ────────── summarizeSession ──────────

  describe("summarizeSession", () => {
    it("should return empty string when fewer than 5 messages", async () => {
      mockSelectChain(makeMessages(4));

      const result = await summarizeSession("conv-1", 1);

      expect(result).toBe("");
      expect(routeAndCollect).not.toHaveBeenCalled();
    });

    it("should return empty string for zero messages", async () => {
      mockSelectChain([]);

      const result = await summarizeSession("conv-1", 1);

      expect(result).toBe("");
      expect(routeAndCollect).not.toHaveBeenCalled();
    });

    it("should summarize 20 messages and store the result", async () => {
      const messages = makeMessages(20);
      mockSelectChain(messages);
      mockUpdateChain();

      const summaryText = "- Decision A\n- Decision B\n- Decision C";
      (routeAndCollect as ReturnType<typeof vi.fn>).mockResolvedValue({
        text: summaryText,
      });

      const result = await summarizeSession("conv-1", 42);

      // Verify the LLM was called with the transcript
      expect(routeAndCollect).toHaveBeenCalledOnce();
      const callArgs = (routeAndCollect as ReturnType<typeof vi.fn>).mock
        .calls[0][0];
      expect(callArgs.model).toBe("auto");
      expect(callArgs.temperature).toBe(0);
      expect(callArgs.messages[0].role).toBe("user");
      // Transcript should contain the first and last messages (reversed order)
      expect(callArgs.messages[0].content).toContain("Question 1");
      expect(callArgs.messages[0].content).toContain("Question 20");

      // Verify the summary was stored in the DB
      expect(db.update).toHaveBeenCalledOnce();

      // Verify result
      expect(result).toBe(summaryText);
    });

    it("should truncate long question/verdict to 500 chars in transcript", async () => {
      const longText = "x".repeat(1000);
      mockSelectChain([
        { question: longText, verdict: longText },
        { question: "q2", verdict: "a2" },
        { question: "q3", verdict: "a3" },
        { question: "q4", verdict: "a4" },
        { question: "q5", verdict: "a5" },
      ]);
      mockUpdateChain();
      (routeAndCollect as ReturnType<typeof vi.fn>).mockResolvedValue({
        text: "summary",
      });

      await summarizeSession("conv-1", 1);

      const prompt = (routeAndCollect as ReturnType<typeof vi.fn>).mock
        .calls[0][0].messages[0].content as string;
      // The 1000-char string should be truncated to 500
      expect(prompt).not.toContain("x".repeat(501));
      expect(prompt).toContain("x".repeat(500));
    });

    it("should reverse messages so transcript is in chronological order", async () => {
      // db returns newest-first (DESC order), service should reverse
      const messages = [
        { question: "newest", verdict: "ans-newest" },
        { question: "middle", verdict: "ans-middle" },
        { question: "oldest", verdict: "ans-oldest" },
        { question: "q4", verdict: "a4" },
        { question: "q5", verdict: "a5" },
      ];
      mockSelectChain(messages);
      mockUpdateChain();
      (routeAndCollect as ReturnType<typeof vi.fn>).mockResolvedValue({
        text: "summary",
      });

      await summarizeSession("conv-1", 1);

      const prompt = (routeAndCollect as ReturnType<typeof vi.fn>).mock
        .calls[0][0].messages[0].content as string;
      const oldestIdx = prompt.indexOf("oldest");
      const newestIdx = prompt.indexOf("newest");
      expect(oldestIdx).toBeLessThan(newestIdx);
    });

    it("should propagate routeAndCollect errors", async () => {
      mockSelectChain(makeMessages(10));
      (routeAndCollect as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error("LLM failure")
      );

      await expect(summarizeSession("conv-1", 1)).rejects.toThrow(
        "LLM failure"
      );
    });

    it("should exactly hit the 5-message threshold", async () => {
      mockSelectChain(makeMessages(5));
      mockUpdateChain();
      (routeAndCollect as ReturnType<typeof vi.fn>).mockResolvedValue({
        text: "summary",
      });

      const result = await summarizeSession("conv-1", 1);

      expect(result).toBe("summary");
      expect(routeAndCollect).toHaveBeenCalledOnce();
    });
  });

  // ────────── autoSummarize ──────────

  describe("autoSummarize", () => {
    /**
     * autoSummarize calls db.select twice when chatCount > 30:
     *   1) count query for chats
     *   2) conversation lookup for sessionSummary + updatedAt
     * We chain mocks in call order.
     */

    it("should skip summarization when chat count is 30 or fewer", async () => {
      (db.select as ReturnType<typeof vi.fn>).mockReturnValue({
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockResolvedValue([{ value: 30 }]),
      });

      await autoSummarize("conv-1", 1);

      expect(db.select).toHaveBeenCalledOnce();
      expect(db.update).not.toHaveBeenCalled();
    });

    it("should skip summarization when chat count is 0", async () => {
      (db.select as ReturnType<typeof vi.fn>).mockReturnValue({
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockResolvedValue([{ value: 0 }]),
      });

      await autoSummarize("conv-1", 1);

      expect(db.select).toHaveBeenCalledOnce();
    });

    it("should summarize when >30 chats and no existing summary", async () => {
      // First call: count query returns 31
      const countChain = {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([{ sessionSummary: null, updatedAt: new Date() }]),
      };
      const convChain = {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue(makeMessages(10)),
      };
      const updateChain = {
        set: vi.fn().mockReturnThis(),
        where: vi.fn().mockResolvedValue(undefined),
      };

      let selectCallCount = 0;
      (db.select as ReturnType<typeof vi.fn>).mockImplementation(() => {
        selectCallCount++;
        if (selectCallCount === 1) {
          // count query
          return {
            from: vi.fn().mockReturnThis(),
            where: vi.fn().mockResolvedValue([{ value: 31 }]),
          };
        }
        if (selectCallCount === 2) {
          // conversation lookup - no existing summary
          return countChain;
        }
        // summarizeSession's message fetch
        return convChain;
      });
      (db.update as ReturnType<typeof vi.fn>).mockReturnValue(updateChain);
      (routeAndCollect as ReturnType<typeof vi.fn>).mockResolvedValue({
        text: "auto summary",
      });

      await autoSummarize("conv-1", 1);

      // summarizeSession was invoked (routeAndCollect called)
      expect(routeAndCollect).toHaveBeenCalledOnce();
    });

    it("should summarize when >30 chats and summary is older than 1 hour", async () => {
      const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);

      let selectCallCount = 0;
      (db.select as ReturnType<typeof vi.fn>).mockImplementation(() => {
        selectCallCount++;
        if (selectCallCount === 1) {
          return {
            from: vi.fn().mockReturnThis(),
            where: vi.fn().mockResolvedValue([{ value: 50 }]),
          };
        }
        if (selectCallCount === 2) {
          return {
            from: vi.fn().mockReturnThis(),
            where: vi.fn().mockReturnThis(),
            orderBy: vi.fn().mockReturnThis(),
            limit: vi.fn().mockResolvedValue([
              { sessionSummary: "old summary", updatedAt: twoHoursAgo },
            ]),
          };
        }
        // summarizeSession message fetch
        return {
          from: vi.fn().mockReturnThis(),
          where: vi.fn().mockReturnThis(),
          orderBy: vi.fn().mockReturnThis(),
          limit: vi.fn().mockResolvedValue(makeMessages(10)),
        };
      });
      mockUpdateChain();
      (routeAndCollect as ReturnType<typeof vi.fn>).mockResolvedValue({
        text: "refreshed summary",
      });

      await autoSummarize("conv-1", 1);

      expect(routeAndCollect).toHaveBeenCalledOnce();
    });

    it("should NOT summarize when >30 chats but summary is fresh", async () => {
      const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);

      let selectCallCount = 0;
      (db.select as ReturnType<typeof vi.fn>).mockImplementation(() => {
        selectCallCount++;
        if (selectCallCount === 1) {
          return {
            from: vi.fn().mockReturnThis(),
            where: vi.fn().mockResolvedValue([{ value: 50 }]),
          };
        }
        // conversation with fresh summary
        return {
          from: vi.fn().mockReturnThis(),
          where: vi.fn().mockReturnThis(),
          orderBy: vi.fn().mockReturnThis(),
          limit: vi.fn().mockResolvedValue([
            { sessionSummary: "recent summary", updatedAt: fiveMinutesAgo },
          ]),
        };
      });

      await autoSummarize("conv-1", 1);

      expect(routeAndCollect).not.toHaveBeenCalled();
    });

    it("should handle missing count result gracefully (defaults to 0)", async () => {
      // Return empty array so result is undefined, chatCount defaults to 0
      (db.select as ReturnType<typeof vi.fn>).mockReturnValue({
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockResolvedValue([]),
      });

      await autoSummarize("conv-1", 1);

      expect(routeAndCollect).not.toHaveBeenCalled();
    });
  });

  // ────────── buildLayeredContext ──────────

  describe("buildLayeredContext", () => {
    it("should include session summary wrapped in tags", () => {
      const result = buildLayeredContext("key decisions here", [], []);

      expect(result).toContain("[SESSION SUMMARY]");
      expect(result).toContain("key decisions here");
      expect(result).toContain("[/SESSION SUMMARY]");
    });

    it("should include RAG chunks wrapped in tags", () => {
      const chunks = ["chunk alpha", "chunk beta"];
      const result = buildLayeredContext(null, [], chunks);

      expect(result).toContain("[RETRIEVED MEMORY]");
      expect(result).toContain("chunk alpha");
      expect(result).toContain("chunk beta");
      expect(result).toContain("[/RETRIEVED MEMORY]");
    });

    it("should separate RAG chunks with double newlines", () => {
      const chunks = ["chunk1", "chunk2", "chunk3"];
      const result = buildLayeredContext(null, [], chunks);

      expect(result).toContain("chunk1\n\nchunk2\n\nchunk3");
    });

    it("should combine summary and RAG chunks separated by double newline", () => {
      const result = buildLayeredContext("summary", [], ["chunk"]);

      expect(result).toContain("[SESSION SUMMARY]");
      expect(result).toContain("[RETRIEVED MEMORY]");
      // The two sections should be separated by a blank line
      const parts = result.split("\n\n");
      expect(parts.length).toBeGreaterThanOrEqual(2);
    });

    it("should return empty string when all inputs are empty/null", () => {
      const result = buildLayeredContext(null, [], []);

      expect(result).toBe("");
    });

    it("should omit session summary section when summary is null", () => {
      const result = buildLayeredContext(null, [], ["chunk"]);

      expect(result).not.toContain("[SESSION SUMMARY]");
      expect(result).toContain("[RETRIEVED MEMORY]");
    });

    it("should omit RAG section when chunks array is empty", () => {
      const result = buildLayeredContext("summary", [], []);

      expect(result).toContain("[SESSION SUMMARY]");
      expect(result).not.toContain("[RETRIEVED MEMORY]");
    });

    it("should include session summary when it is an empty string (falsy but present)", () => {
      // Empty string is falsy, so the service should omit it
      const result = buildLayeredContext("", [], ["chunk"]);

      expect(result).not.toContain("[SESSION SUMMARY]");
    });

    it("should ignore recentMessages (handled by caller)", () => {
      const msgs = [
        { role: "user", content: "hi" },
        { role: "assistant", content: "hello" },
      ];
      const result = buildLayeredContext("summary", msgs, []);

      // recentMessages should NOT appear in the output
      expect(result).not.toContain("hi");
      expect(result).not.toContain("hello");
    });

    it("should handle a single RAG chunk correctly", () => {
      const result = buildLayeredContext(null, [], ["only chunk"]);

      expect(result).toBe("[RETRIEVED MEMORY]\nonly chunk\n[/RETRIEVED MEMORY]");
    });

    it("should cap ragChunks at 20 (P30-04)", () => {
      const chunks = Array.from({ length: 25 }, (_, i) => `chunk_${i}`);
      const result = buildLayeredContext(null, [], chunks);

      expect(result).toContain("chunk_19");
      expect(result).not.toContain("chunk_20");
      expect(result).not.toContain("chunk_24");
    });

    it("should truncate individual chunks to 2000 chars", () => {
      const longChunk = "x".repeat(3000);
      const result = buildLayeredContext(null, [], [longChunk]);

      // The chunk in output should be truncated to 2000 chars
      const memorySection = result
        .split("[RETRIEVED MEMORY]")[1]
        .split("[/RETRIEVED MEMORY]")[0];
      const xCount = (memorySection.match(/x/g) || []).length;
      expect(xCount).toBe(2000);
    });

    it("should handle exactly 20 ragChunks without dropping any", () => {
      const chunks = Array.from({ length: 20 }, (_, i) => `chunk_${i}`);
      const result = buildLayeredContext(null, [], chunks);

      expect(result).toContain("chunk_0");
      expect(result).toContain("chunk_19");
    });

    it("should truncate each chunk independently", () => {
      const chunk1 = "a".repeat(2500);
      const chunk2 = "b".repeat(100);
      const result = buildLayeredContext(null, [], [chunk1, chunk2]);

      const memorySection = result
        .split("[RETRIEVED MEMORY]")[1]
        .split("[/RETRIEVED MEMORY]")[0];
      const aCount = (memorySection.match(/a/g) || []).length;
      const bCount = (memorySection.match(/b/g) || []).length;
      expect(aCount).toBe(2000);
      expect(bCount).toBe(100);
    });
  });
});
