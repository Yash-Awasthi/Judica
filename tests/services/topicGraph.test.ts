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

// Mock embeddings
const mockEmbed = vi.fn();
vi.mock("../../src/services/embeddings.service.js", () => ({
  embed: (...args: unknown[]) => mockEmbed(...args),
}));

// Mock db
const mockDbExecute = vi.fn();
const mockDbSelect = vi.fn();
vi.mock("../../src/lib/drizzle.js", () => ({
  db: {
    execute: (...args: unknown[]) => mockDbExecute(...args),
    select: (...args: unknown[]) => {
      const result = mockDbSelect(...args);
      return {
        from: () => ({
          where: () => result || [],
        }),
      };
    },
  },
}));

// Mock drizzle-orm
vi.mock("drizzle-orm", () => ({
  sql: Object.assign((strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, values }), { raw: (s: string) => s }),
  eq: vi.fn((...args: unknown[]) => ({ type: "eq", args })),
  and: vi.fn((...args: unknown[]) => ({ type: "and", args })),
}));

// Mock conversations schema
vi.mock("../../src/db/schema/conversations.js", () => ({
  topicNodes: {
    id: "id",
    userId: "userId",
    label: "label",
    summary: "summary",
    conversationIds: "conversationIds",
    strength: "strength",
  },
  topicEdges: {
    id: "id",
    sourceTopicId: "sourceTopicId",
    targetTopicId: "targetTopicId",
    weight: "weight",
  },
}));

// Mock vectorStore
vi.mock("../../src/services/vectorStore.service.js", () => ({
  safeVectorLiteral: (vec: number[]) => `[${vec.join(",")}]`,
}));

// Mock router
const mockRouteAndCollect = vi.fn();
vi.mock("../../src/router/index.js", () => ({
  routeAndCollect: (...args: unknown[]) => mockRouteAndCollect(...args),
}));

import {
  linkConversationTopics,
  findRelatedConversations,
  getTopicGraph,
} from "../../src/services/topicGraph.service.js";

describe("topicGraph.service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEmbed.mockResolvedValue([0.1, 0.2, 0.3]);
  });

  describe("linkConversationTopics", () => {
    it("should extract topics and create new topic nodes", async () => {
      mockRouteAndCollect.mockResolvedValue({
        text: '["Machine Learning", "Neural Networks"]',
      });

      // No existing similar topics
      mockDbExecute.mockResolvedValue({ rows: [] });

      const result = await linkConversationTopics(
        1,
        "conv-1",
        "ML Discussion",
        ["What is machine learning?", "It's a subset of AI..."]
      );

      expect(result).toHaveLength(2);
      expect(result[0].label).toBe("Machine Learning");
      expect(result[0].conversationIds).toContain("conv-1");
      expect(result[1].label).toBe("Neural Networks");
    });

    it("should merge with existing similar topics", async () => {
      mockRouteAndCollect.mockResolvedValue({
        text: '["Deep Learning"]',
      });

      // Existing similar topic found
      mockDbExecute.mockResolvedValueOnce({
        rows: [{
          id: "existing-topic",
          label: "Deep Learning",
          summary: null,
          conversationIds: ["conv-old"],
          strength: 3,
          similarity: 0.95,
        }],
      }).mockResolvedValue({ rows: [] }); // for the UPDATE

      const result = await linkConversationTopics(
        1,
        "conv-2",
        "DL Discussion",
        ["Tell me about deep learning"]
      );

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("existing-topic");
      // The returned object contains the original conversationIds from DB
      // (the new conversationId is appended via atomic SQL UPDATE, not in the JS object)
      expect(result[0].conversationIds).toContain("conv-old");
      expect(result[0].strength).toBe(4);
    });

    it("should return empty array when no topics extracted", async () => {
      mockRouteAndCollect.mockResolvedValue({ text: "[]" });

      const result = await linkConversationTopics(
        1,
        "conv-1",
        "Empty",
        ["hi"]
      );

      expect(result).toHaveLength(0);
    });

    it("should handle LLM extraction failure gracefully", async () => {
      mockRouteAndCollect.mockRejectedValue(new Error("LLM error"));

      const result = await linkConversationTopics(
        1,
        "conv-1",
        "Error test",
        ["content"]
      );

      expect(result).toHaveLength(0);
    });
  });

  describe("findRelatedConversations", () => {
    it("should find conversations related to a query", async () => {
      mockDbExecute.mockResolvedValue({
        rows: [
          {
            id: "topic-1",
            label: "Machine Learning",
            conversationIds: ["conv-1", "conv-2"],
            score: 0.9,
          },
          {
            id: "topic-2",
            label: "Data Science",
            conversationIds: ["conv-2", "conv-3"],
            score: 0.7,
          },
        ],
      });

      const result = await findRelatedConversations(1, "ML algorithms");

      expect(result.length).toBeGreaterThan(0);
      // conv-2 appears in both topics, should be included
      const conv2 = result.find((r) => r.conversationId === "conv-2");
      expect(conv2).toBeDefined();
      expect(conv2!.topics.length).toBeGreaterThanOrEqual(1);
    });

    it("should filter out low-similarity results", async () => {
      mockDbExecute.mockResolvedValue({
        rows: [
          { id: "t1", label: "Cooking", conversationIds: ["conv-1"], score: 0.3 },
        ],
      });

      const result = await findRelatedConversations(1, "quantum physics");
      expect(result).toHaveLength(0);
    });
  });

  describe("getTopicGraph", () => {
    it("should return empty graph for user with no topics", async () => {
      mockDbSelect.mockReturnValue([]);

      const graph = await getTopicGraph(1);
      expect(graph.nodes).toHaveLength(0);
      expect(graph.edges).toHaveLength(0);
    });

    it("should return nodes and edges", async () => {
      mockDbSelect.mockReturnValue([
        { id: "t1", label: "AI", summary: null, conversationIds: ["c1"], strength: 3 },
        { id: "t2", label: "ML", summary: null, conversationIds: ["c1", "c2"], strength: 5 },
      ]);
      mockDbExecute.mockResolvedValue({
        rows: [
          { sourceTopicId: "t1", targetTopicId: "t2", weight: 2 },
        ],
      });

      const graph = await getTopicGraph(1);
      expect(graph.nodes).toHaveLength(2);
      expect(graph.edges).toHaveLength(1);
      expect(graph.edges[0].weight).toBe(2);
    });
  });
});
