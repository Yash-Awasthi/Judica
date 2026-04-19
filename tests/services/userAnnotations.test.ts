import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../src/lib/logger.js", () => ({
  default: {
    info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), child: vi.fn().mockReturnThis(),
  },
}));

import {
  createAnnotation,
  getAnnotationsForMessage,
  getAnnotationsForConversation,
  getUserAnnotations,
  deleteAnnotation,
  updateAnnotation,
  _reset,
} from "../../src/services/userAnnotations.service.js";

describe("userAnnotations.service", () => {
  beforeEach(() => {
    _reset();
  });

  describe("createAnnotation", () => {
    it("creates an annotation with all fields", () => {
      const ann = createAnnotation("u1", "conv1", "msg1", "highlight", "important", { start: 0, end: 10 });
      expect(ann.id).toBeTruthy();
      expect(ann.userId).toBe("u1");
      expect(ann.conversationId).toBe("conv1");
      expect(ann.messageId).toBe("msg1");
      expect(ann.type).toBe("highlight");
      expect(ann.content).toBe("important");
      expect(ann.selection).toEqual({ start: 0, end: 10 });
      expect(ann.createdAt).toBeInstanceOf(Date);
    });

    it("creates annotation without selection", () => {
      const ann = createAnnotation("u1", "conv1", "msg1", "bookmark", "saved");
      expect(ann.selection).toBeUndefined();
    });
  });

  describe("getAnnotationsForMessage", () => {
    it("returns all annotations for a message", () => {
      createAnnotation("u1", "conv1", "msg1", "highlight", "a");
      createAnnotation("u2", "conv1", "msg1", "comment", "b");
      createAnnotation("u1", "conv1", "msg2", "flag", "c");

      const result = getAnnotationsForMessage("msg1");
      expect(result).toHaveLength(2);
    });

    it("returns empty array when no annotations", () => {
      expect(getAnnotationsForMessage("none")).toHaveLength(0);
    });
  });

  describe("getAnnotationsForConversation", () => {
    it("returns all annotations for a conversation", () => {
      createAnnotation("u1", "conv1", "msg1", "highlight", "a");
      createAnnotation("u1", "conv1", "msg2", "comment", "b");
      createAnnotation("u1", "conv2", "msg3", "flag", "c");

      const result = getAnnotationsForConversation("conv1");
      expect(result).toHaveLength(2);
    });
  });

  describe("getUserAnnotations", () => {
    it("returns annotations sorted by recency", () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2025-01-01T00:00:00Z"));
      const a1 = createAnnotation("u1", "conv1", "msg1", "highlight", "first");
      vi.setSystemTime(new Date("2025-01-01T00:01:00Z"));
      const a2 = createAnnotation("u1", "conv1", "msg2", "comment", "second");
      vi.useRealTimers();

      const result = getUserAnnotations("u1");
      expect(result).toHaveLength(2);
      // Most recent first
      expect(result[0].id).toBe(a2.id);
    });

    it("respects limit parameter", () => {
      createAnnotation("u1", "conv1", "msg1", "highlight", "a");
      createAnnotation("u1", "conv1", "msg2", "comment", "b");
      createAnnotation("u1", "conv1", "msg3", "flag", "c");

      const result = getUserAnnotations("u1", 2);
      expect(result).toHaveLength(2);
    });
  });

  describe("deleteAnnotation", () => {
    it("deletes annotation by owner", () => {
      const ann = createAnnotation("u1", "conv1", "msg1", "highlight", "a");
      expect(deleteAnnotation(ann.id, "u1")).toBe(true);
      expect(getAnnotationsForMessage("msg1")).toHaveLength(0);
    });

    it("throws if not owner", () => {
      const ann = createAnnotation("u1", "conv1", "msg1", "highlight", "a");
      expect(() => deleteAnnotation(ann.id, "u2")).toThrow("owner");
    });

    it("throws if annotation not found", () => {
      expect(() => deleteAnnotation("nope", "u1")).toThrow("not found");
    });
  });

  describe("updateAnnotation", () => {
    it("updates annotation content by owner", () => {
      const ann = createAnnotation("u1", "conv1", "msg1", "comment", "old");
      const updated = updateAnnotation(ann.id, "u1", "new content");
      expect(updated.content).toBe("new content");
    });

    it("throws if not owner", () => {
      const ann = createAnnotation("u1", "conv1", "msg1", "comment", "old");
      expect(() => updateAnnotation(ann.id, "u2", "new")).toThrow("owner");
    });

    it("throws if annotation not found", () => {
      expect(() => updateAnnotation("nope", "u1", "x")).toThrow("not found");
    });
  });
});
