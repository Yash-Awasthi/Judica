import { describe, it, expect, vi, beforeEach } from "vitest";
import { 
  createConversation, 
  findConversationById, 
  createChat, 
  getRecentHistory, 
  getConversationList, 
  deleteConversation, 
  updateConversationTitle,
  retrieveRelevantContext,
  formatContextForInjection
} from "../../src/services/conversationService.js";
import { db } from "../../src/lib/drizzle.js";
import { getEmbeddingWithLock } from "../../src/lib/cache.js";

vi.mock("../../src/lib/drizzle.js", () => ({
  db: {
    insert: vi.fn(() => ({
      values: vi.fn(() => ({
        returning: vi.fn().mockResolvedValue([{ id: "conv-1", title: "Test" }])
      }))
    })),
    select: vi.fn(),
    execute: vi.fn(),
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(() => ({
          returning: vi.fn().mockResolvedValue([{ id: "conv-1", title: "New Title" }])
        }))
      }))
    })),
    delete: vi.fn(() => ({
      where: vi.fn(() => ({
        returning: vi.fn().mockResolvedValue([{ id: "conv-1" }])
      }))
    })),
  }
}));

vi.mock("../../src/lib/cache.js", () => ({
  getEmbeddingWithLock: vi.fn().mockResolvedValue([0.1, 0.2, 0.3])
}));

vi.mock("../../src/lib/logger.js", () => ({
  default: { error: vi.fn(), warn: vi.fn(), debug: vi.fn() }
}));

describe("Conversation Service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("createConversation", () => {
    it("should create a new conversation", async () => {
      const conv = await createConversation({ title: "New Conv", userId: 1 });
      expect(conv.id).toBe("conv-1");
      expect(db.insert).toHaveBeenCalled();
    });

    it("should throw on failure", async () => {
      vi.mocked(db.insert).mockImplementationOnce(() => { throw new Error("DB fail"); });
      await expect(createConversation({ title: "fail" })).rejects.toThrow("DB fail");
    });
  });

  describe("findConversationById", () => {
    it("should find conversation", async () => {
      vi.mocked(db.select).mockReturnValue({
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([{ id: "conv-1" }])
      } as any);

      const conv = await findConversationById("conv-1", 1);
      expect(conv?.id).toBe("conv-1");
    });
  });

  describe("createChat", () => {
    it("should create chat without embedding", async () => {
      vi.mocked(db.insert).mockReturnValue({
        values: vi.fn(() => ({
          returning: vi.fn().mockResolvedValue([{ id: 123 }])
        }))
      } as any);

      const chat = await createChat({ question: "q", verdict: "v", opinions: {} });
      expect(chat.id).toBe(123);
    });

    it("should create chat with embedding via execute", async () => {
      vi.mocked(db.execute).mockResolvedValue({ rows: [{ id: 456 }] } as any);
      const chat = await createChat({ question: "q", verdict: "v", opinions: {} }, true);
      expect(chat.id).toBe(456);
      expect(db.execute).toHaveBeenCalled();
    });
  });

  describe("getRecentHistory", () => {
    it("should map chats to messages", async () => {
      vi.mocked(db.select).mockReturnValue({
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([
          { question: "q1", verdict: "v1" },
          { question: "q2", verdict: "v2" }
        ])
      } as any);

      const history = await getRecentHistory("conv-1");
      expect(history).toHaveLength(4);
      expect(history[0]).toEqual({ role: "user", content: "q1" });
    });
  });

  describe("retrieveRelevantContext", () => {
    it("should retrieve using semantic search if embedding exists", async () => {
      vi.mocked(db.execute).mockResolvedValue({
        rows: [{ question: "sq1", verdict: "sv1", distance: 0.1 }]
      } as any);

      const context = await retrieveRelevantContext("conv-1", "test query");
      expect(context).toHaveLength(1);
      expect(context[0].question).toBe("sq1");
    });

    it("should fallback to keyword search if semantic search fails", async () => {
      vi.mocked(db.execute).mockRejectedValueOnce(new Error("Vector fail"));
      vi.mocked(db.select).mockReturnValue({
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([
          { question: "test matching keywords", verdict: "answer" }
        ])
      } as any);

      const context = await retrieveRelevantContext("conv-1", "test");
      expect(context).toHaveLength(1);
      expect(context[0].relevance).toBeGreaterThan(0);
    });

    it("should handle empty history gracefully", async () => {
      vi.mocked(getEmbeddingWithLock).mockResolvedValueOnce(null);
      vi.mocked(db.select).mockReturnValue({
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([])
      } as any);

      const context = await retrieveRelevantContext("conv-1", "q");
      expect(context).toHaveLength(0);
    });
  });

  describe("formatContextForInjection", () => {
    it("should format context correctly", () => {
      const ctx = [{ question: "q", verdict: "v", relevance: 0.9 }];
      const formatted = formatContextForInjection(ctx);
      expect(formatted).toContain("Relevant past context:");
      expect(formatted).toContain("Past Q1: q");
    });

    it("should return empty string for empty context", () => {
      expect(formatContextForInjection([])).toBe("");
    });

    it("should truncate long context", () => {
      const longCtx = Array(20).fill({ question: "long question ".repeat(50), verdict: "long verdict ".repeat(50), relevance: 1.0 });
      const formatted = formatContextForInjection(longCtx);
      expect(formatted).toContain("... [truncated]");
    });
  });

  describe("updateConversationTitle", () => {
    it("should update and return conversation", async () => {
      const result = await updateConversationTitle("conv-1", 1, "New Title");
      expect(result?.title).toBe("New Title");
    });

    it("should return null if not found", async () => {
      vi.mocked(db.update).mockReturnValue({
        set: vi.fn(() => ({
          where: vi.fn(() => ({
            returning: vi.fn().mockResolvedValue([])
          }))
        }))
      } as any);
      const result = await updateConversationTitle("none", 1, "title");
      expect(result).toBeNull();
    });
  });

  describe("deleteConversation", () => {
    it("should return true on success", async () => {
      const ok = await deleteConversation("conv-1", 1);
      expect(ok).toBe(true);
    });

    it("should return false if nothing deleted", async () => {
      vi.mocked(db.delete).mockReturnValue({
        where: vi.fn(() => ({
          returning: vi.fn().mockResolvedValue([])
        }))
      } as any);
      const ok = await deleteConversation("none", 1);
      expect(ok).toBe(false);
    });
  });

    it("should fetch list with pagination", async () => {
      const mockResult = [{ id: "c1" }];
      const mockCount = [{ count: 1 }];

      vi.mocked(db.select).mockReturnValueOnce({
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        offset: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue(mockResult)
      } as any);

      vi.mocked(db.select).mockReturnValueOnce({
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockResolvedValue(mockCount)
      } as any);

      const result = await getConversationList(1, 10, 0);
      expect(result.data).toHaveLength(1);
      expect(result.total).toBe(1);
    });
});
