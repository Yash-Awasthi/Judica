import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock logger
vi.mock("../../src/lib/logger.js", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// Mock env
vi.mock("../../src/config/env.js", () => ({
  env: {
    DATABASE_URL: "postgresql://test:test@localhost:5432/test",
    JWT_SECRET: "test-jwt-secret-min-16-chars",
    MASTER_ENCRYPTION_KEY: "test-master-encryption-key-min-32-characters-long",
  },
}));

// Mock drizzle db
const mockSelect = vi.fn();
const mockFrom = vi.fn();
const mockWhere = vi.fn();
vi.mock("../../src/lib/drizzle.js", () => ({
  db: {
    select: () => ({ from: () => ({ where: mockWhere }) }),
  },
}));

// Mock uploads schema
vi.mock("../../src/db/schema/uploads.js", () => ({
  uploads: { id: "id", userId: "userId" },
}));

// Mock vectorStore
const mockHybridSearch = vi.fn();
vi.mock("../../src/services/vectorStore.service.js", () => ({
  hybridSearch: (...args: unknown[]) => mockHybridSearch(...args),
}));

// Mock fs
const mockReadFileSync = vi.fn();
vi.mock("fs", () => ({
  readFileSync: (...args: unknown[]) => mockReadFileSync(...args),
}));

vi.mock("fs/promises", () => ({
  readFile: vi.fn(),
}));

// Mock drizzle-orm
vi.mock("drizzle-orm", () => ({
  eq: vi.fn((...args: unknown[]) => ({ type: "eq", args })),
  inArray: vi.fn((...args: unknown[]) => ({ type: "inArray", args })),
  and: vi.fn((...args: unknown[]) => ({ type: "and", args })),
}));

describe("messageBuilder.service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("loadFileContext", () => {
    it("returns empty context when no uploadIds provided", async () => {
      const { loadFileContext } = await import("../../src/services/messageBuilder.service.js");
      const result = await loadFileContext([], 1);
      expect(result).toEqual({ text_documents: [], image_blocks: [] });
    });

    it("returns empty context when uploadIds is empty array", async () => {
      vi.resetModules();
      const { loadFileContext } = await import("../../src/services/messageBuilder.service.js");
      const result = await loadFileContext([], 42);
      expect(result).toEqual({ text_documents: [], image_blocks: [] });
    });

    it("loads text documents from uploads", async () => {
      vi.resetModules();
      mockWhere.mockResolvedValue([
        {
          id: "upload-1",
          userId: 1,
          mimeType: "text/plain",
          originalName: "notes.txt",
          extractedText: "Some important notes",
          storagePath: "/uploads/notes.txt",
        },
      ]);

      const { loadFileContext } = await import("../../src/services/messageBuilder.service.js");
      const result = await loadFileContext(["upload-1"], 1);

      expect(result.text_documents).toHaveLength(1);
      expect(result.text_documents[0]).toContain("[DOCUMENT: notes.txt]");
      expect(result.text_documents[0]).toContain("Some important notes");
      expect(result.image_blocks).toHaveLength(0);
    });

    it("loads image uploads as base64 blocks", async () => {
      vi.resetModules();
      mockWhere.mockResolvedValue([
        {
          id: "upload-2",
          userId: 1,
          mimeType: "image/png",
          originalName: "screenshot.png",
          storagePath: "/uploads/screenshot.png",
        },
      ]);
      mockReadFileSync.mockReturnValue(Buffer.from("fake-png-data"));

      const { loadFileContext } = await import("../../src/services/messageBuilder.service.js");
      const result = await loadFileContext(["upload-2"], 1);

      expect(result.image_blocks).toHaveLength(1);
      expect(result.image_blocks[0].mimeType).toBe("image/png");
      expect(result.image_blocks[0].filename).toBe("screenshot.png");
      expect(result.image_blocks[0].base64).toBe(Buffer.from("fake-png-data").toString("base64"));
      expect(result.text_documents).toHaveLength(0);
    });

    it("handles image read failure gracefully", async () => {
      vi.resetModules();
      mockWhere.mockResolvedValue([
        {
          id: "upload-3",
          userId: 1,
          mimeType: "image/jpeg",
          originalName: "broken.jpg",
          storagePath: "/uploads/broken.jpg",
        },
      ]);
      mockReadFileSync.mockImplementation(() => {
        throw new Error("ENOENT: file not found");
      });

      const { loadFileContext } = await import("../../src/services/messageBuilder.service.js");
      const result = await loadFileContext(["upload-3"], 1);

      expect(result.image_blocks).toHaveLength(0);
      expect(result.text_documents).toHaveLength(0);
    });
  });

  describe("loadRAGContext", () => {
    it("returns empty context when no chunks found", async () => {
      vi.resetModules();
      mockHybridSearch.mockResolvedValue([]);

      const { loadRAGContext } = await import("../../src/services/messageBuilder.service.js");
      const result = await loadRAGContext(1, "test query", "kb-1");

      expect(result.context).toBe("");
      expect(result.citations).toEqual([]);
    });

    it("builds context and citations from chunks", async () => {
      vi.resetModules();
      mockHybridSearch.mockResolvedValue([
        { content: "Chunk 1 content", sourceName: "doc1.pdf", score: 0.95 },
        { content: "Chunk 2 content", sourceName: "doc2.md", score: 0.82 },
      ]);

      const { loadRAGContext } = await import("../../src/services/messageBuilder.service.js");
      const result = await loadRAGContext(1, "test query", "kb-1", 5);

      expect(result.context).toContain("[KNOWLEDGE BASE CONTEXT]");
      expect(result.context).toContain("Chunk 1 content");
      expect(result.context).toContain("Chunk 2 content");
      expect(result.context).toContain("Source: doc1.pdf");
      expect(result.citations).toHaveLength(2);
      expect(result.citations[0]).toEqual({ source: "doc1.pdf", score: 0.95 });
    });

    it("handles search error gracefully", async () => {
      vi.resetModules();
      mockHybridSearch.mockRejectedValue(new Error("Search failed"));

      const { loadRAGContext } = await import("../../src/services/messageBuilder.service.js");
      const result = await loadRAGContext(1, "test query", "kb-1");

      expect(result.context).toBe("");
      expect(result.citations).toEqual([]);
    });
  });

  describe("buildEnrichedQuestion", () => {
    it("returns plain string when no images", async () => {
      vi.resetModules();
      const { buildEnrichedQuestion } = await import("../../src/services/messageBuilder.service.js");

      const result = buildEnrichedQuestion(
        "What is AI?",
        { text_documents: [], image_blocks: [] },
        "",
        ""
      );

      expect(typeof result).toBe("string");
      expect(result).toContain("QUESTION: What is AI?");
    });

    it("includes RAG context when provided", async () => {
      vi.resetModules();
      const { buildEnrichedQuestion } = await import("../../src/services/messageBuilder.service.js");

      const result = buildEnrichedQuestion(
        "Tell me about X",
        { text_documents: [], image_blocks: [] },
        "[KNOWLEDGE BASE CONTEXT]\nSome context\n[/KNOWLEDGE BASE CONTEXT]",
        ""
      );

      expect(result).toContain("[KNOWLEDGE BASE CONTEXT]");
      expect(result).toContain("QUESTION: Tell me about X");
    });

    it("includes file context text documents", async () => {
      vi.resetModules();
      const { buildEnrichedQuestion } = await import("../../src/services/messageBuilder.service.js");

      const result = buildEnrichedQuestion(
        "Summarize this",
        { text_documents: ["[DOCUMENT: file.txt]\nContent\n[/DOCUMENT]"], image_blocks: [] },
        "",
        ""
      );

      expect(result).toContain("[DOCUMENT: file.txt]");
      expect(result).toContain("QUESTION: Summarize this");
    });

    it("includes memory context", async () => {
      vi.resetModules();
      const { buildEnrichedQuestion } = await import("../../src/services/messageBuilder.service.js");

      const result = buildEnrichedQuestion(
        "Hello",
        { text_documents: [], image_blocks: [] },
        "",
        "User prefers detailed answers"
      );

      expect(result).toContain("User prefers detailed answers");
    });

    it("includes ground truth context when provided", async () => {
      vi.resetModules();
      const { buildEnrichedQuestion } = await import("../../src/services/messageBuilder.service.js");

      const result = buildEnrichedQuestion(
        "Evaluate this",
        { text_documents: [], image_blocks: [] },
        "",
        "",
        "Expected answer: 42"
      );

      expect(result).toContain("GROUND TRUTH CONTEXT:");
      expect(result).toContain("Expected answer: 42");
    });

    it("returns content blocks array when images are present", async () => {
      vi.resetModules();
      const { buildEnrichedQuestion } = await import("../../src/services/messageBuilder.service.js");

      const result = buildEnrichedQuestion(
        "Describe this image",
        {
          text_documents: [],
          image_blocks: [
            { base64: "aGVsbG8=", mimeType: "image/png", filename: "test.png" },
          ],
        },
        "",
        ""
      );

      expect(Array.isArray(result)).toBe(true);
      const blocks = result as any[];
      expect(blocks).toHaveLength(2);
      expect(blocks[0].type).toBe("text");
      expect(blocks[0].text).toContain("QUESTION: Describe this image");
      expect(blocks[1].type).toBe("image_base64");
      expect(blocks[1].data).toBe("aGVsbG8=");
      expect(blocks[1].media_type).toBe("image/png");
    });

    it("includes all context types together", async () => {
      vi.resetModules();
      const { buildEnrichedQuestion } = await import("../../src/services/messageBuilder.service.js");

      const result = buildEnrichedQuestion(
        "Full question",
        { text_documents: ["[DOC]\ntext\n[/DOC]"], image_blocks: [] },
        "RAG context here",
        "Memory context here",
        "Ground truth here"
      );

      expect(typeof result).toBe("string");
      const text = result as string;
      // Verify ordering: ground truth -> rag -> docs -> memory -> question
      const gtIdx = text.indexOf("GROUND TRUTH CONTEXT:");
      const ragIdx = text.indexOf("RAG context here");
      const docIdx = text.indexOf("[DOC]");
      const memIdx = text.indexOf("Memory context here");
      const qIdx = text.indexOf("QUESTION: Full question");

      expect(gtIdx).toBeLessThan(ragIdx);
      expect(ragIdx).toBeLessThan(docIdx);
      expect(docIdx).toBeLessThan(memIdx);
      expect(memIdx).toBeLessThan(qIdx);
    });
  });
});
