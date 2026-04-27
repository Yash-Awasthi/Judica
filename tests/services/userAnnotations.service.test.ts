import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/lib/logger.js", () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn(() => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    })),
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

  // ─── createAnnotation ───────────────────────────────────────────────────────

  describe("createAnnotation", () => {
    it("returns an annotation with all expected fields", () => {
      const ann = createAnnotation("user1", "conv1", "msg1", "highlight", "important text");
      expect(ann.id).toBeTruthy();
      expect(ann.userId).toBe("user1");
      expect(ann.conversationId).toBe("conv1");
      expect(ann.messageId).toBe("msg1");
      expect(ann.type).toBe("highlight");
      expect(ann.content).toBe("important text");
      expect(ann.createdAt).toBeInstanceOf(Date);
    });

    it("generates a unique id for each annotation", () => {
      const a1 = createAnnotation("user1", "conv1", "msg1", "highlight", "a");
      const a2 = createAnnotation("user1", "conv1", "msg1", "highlight", "b");
      expect(a1.id).not.toBe(a2.id);
    });

    it("stores the annotation so it can be retrieved by messageId", () => {
      const ann = createAnnotation("user1", "conv1", "msg1", "comment", "check this");
      const result = getAnnotationsForMessage("msg1");
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe(ann.id);
    });

    it("stores the selection field when provided", () => {
      const ann = createAnnotation("user1", "conv1", "msg1", "highlight", "selected", {
        start: 5,
        end: 20,
      });
      expect(ann.selection).toEqual({ start: 5, end: 20 });
    });

    it("leaves selection undefined when not provided", () => {
      const ann = createAnnotation("user1", "conv1", "msg1", "bookmark", "saved");
      expect(ann.selection).toBeUndefined();
    });

    it('supports annotation type "highlight"', () => {
      const ann = createAnnotation("user1", "conv1", "msg1", "highlight", "highlighted");
      expect(ann.type).toBe("highlight");
    });

    it('supports annotation type "comment"', () => {
      const ann = createAnnotation("user1", "conv1", "msg1", "comment", "my note");
      expect(ann.type).toBe("comment");
    });

    it('supports annotation type "flag"', () => {
      const ann = createAnnotation("user1", "conv1", "msg1", "flag", "needs review");
      expect(ann.type).toBe("flag");
    });

    it('supports annotation type "bookmark"', () => {
      const ann = createAnnotation("user1", "conv1", "msg1", "bookmark", "saved for later");
      expect(ann.type).toBe("bookmark");
    });
  });

  // ─── getAnnotationsForMessage ────────────────────────────────────────────────

  describe("getAnnotationsForMessage", () => {
    it("returns an empty array when no annotations exist for the message", () => {
      expect(getAnnotationsForMessage("nonexistent-msg")).toHaveLength(0);
    });

    it("returns only annotations matching the given messageId", () => {
      createAnnotation("user1", "conv1", "msg1", "highlight", "a");
      createAnnotation("user2", "conv1", "msg1", "comment", "b");
      createAnnotation("user1", "conv1", "msg2", "flag", "c");

      const result = getAnnotationsForMessage("msg1");
      expect(result).toHaveLength(2);
      result.forEach((ann) => expect(ann.messageId).toBe("msg1"));
    });

    it("does not include annotations from a different messageId", () => {
      createAnnotation("user1", "conv1", "msg1", "highlight", "a");
      const result = getAnnotationsForMessage("msg2");
      expect(result).toHaveLength(0);
    });
  });

  // ─── getAnnotationsForConversation ──────────────────────────────────────────

  describe("getAnnotationsForConversation", () => {
    it("returns all annotations belonging to a conversation", () => {
      createAnnotation("user1", "conv1", "msg1", "highlight", "a");
      createAnnotation("user1", "conv1", "msg2", "comment", "b");
      createAnnotation("user1", "conv2", "msg3", "flag", "c");

      const result = getAnnotationsForConversation("conv1");
      expect(result).toHaveLength(2);
      result.forEach((ann) => expect(ann.conversationId).toBe("conv1"));
    });

    it("returns an empty array when no annotations exist for the conversation", () => {
      expect(getAnnotationsForConversation("nonexistent-conv")).toHaveLength(0);
    });

    it("does not bleed annotations between different conversations", () => {
      createAnnotation("user1", "conv1", "msg1", "highlight", "only conv1");
      const result = getAnnotationsForConversation("conv2");
      expect(result).toHaveLength(0);
    });
  });

  // ─── getUserAnnotations ──────────────────────────────────────────────────────

  describe("getUserAnnotations", () => {
    it("returns annotations sorted newest first", () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2025-01-01T00:00:00Z"));
      const older = createAnnotation("user1", "conv1", "msg1", "highlight", "older");
      vi.setSystemTime(new Date("2025-01-01T00:05:00Z"));
      const newer = createAnnotation("user1", "conv1", "msg2", "comment", "newer");
      vi.useRealTimers();

      const result = getUserAnnotations("user1");
      expect(result).toHaveLength(2);
      expect(result[0].id).toBe(newer.id);
      expect(result[1].id).toBe(older.id);
    });

    it("returns an empty array for a user with no annotations", () => {
      createAnnotation("user1", "conv1", "msg1", "highlight", "not for user2");
      expect(getUserAnnotations("user2")).toHaveLength(0);
    });

    it("respects an optional limit parameter", () => {
      createAnnotation("user1", "conv1", "msg1", "highlight", "a");
      createAnnotation("user1", "conv1", "msg2", "comment", "b");
      createAnnotation("user1", "conv1", "msg3", "flag", "c");

      const result = getUserAnnotations("user1", 2);
      expect(result).toHaveLength(2);
    });

    it("returns all annotations when limit is not provided", () => {
      createAnnotation("user1", "conv1", "msg1", "highlight", "a");
      createAnnotation("user1", "conv1", "msg2", "comment", "b");
      createAnnotation("user1", "conv1", "msg3", "flag", "c");

      const result = getUserAnnotations("user1");
      expect(result).toHaveLength(3);
    });

    it("filters to the specified user only, ignoring other users' annotations", () => {
      createAnnotation("user1", "conv1", "msg1", "highlight", "u1 ann");
      createAnnotation("user2", "conv1", "msg1", "comment", "u2 ann");

      const result = getUserAnnotations("user1");
      expect(result).toHaveLength(1);
      expect(result[0].userId).toBe("user1");
    });
  });

  // ─── deleteAnnotation ────────────────────────────────────────────────────────

  describe("deleteAnnotation", () => {
    it("returns true when annotation is successfully deleted by the owner", () => {
      const ann = createAnnotation("user1", "conv1", "msg1", "highlight", "to delete");
      expect(deleteAnnotation(ann.id, "user1")).toBe(true);
    });

    it("removes the annotation from the store after deletion", () => {
      const ann = createAnnotation("user1", "conv1", "msg1", "highlight", "to delete");
      deleteAnnotation(ann.id, "user1");
      expect(getAnnotationsForMessage("msg1")).toHaveLength(0);
    });

    it('throws "not found" error when the annotation id does not exist', () => {
      expect(() => deleteAnnotation("nonexistent-id", "user1")).toThrow("not found");
    });

    it('throws "Only the annotation owner can delete it" when userId does not match', () => {
      const ann = createAnnotation("user1", "conv1", "msg1", "highlight", "private");
      expect(() => deleteAnnotation(ann.id, "user2")).toThrow(
        "Only the annotation owner can delete it"
      );
    });

    it("does not delete other annotations when one is deleted", () => {
      const ann1 = createAnnotation("user1", "conv1", "msg1", "highlight", "keep");
      const ann2 = createAnnotation("user1", "conv1", "msg1", "comment", "delete me");
      deleteAnnotation(ann2.id, "user1");
      const remaining = getAnnotationsForMessage("msg1");
      expect(remaining).toHaveLength(1);
      expect(remaining[0].id).toBe(ann1.id);
    });
  });

  // ─── updateAnnotation ────────────────────────────────────────────────────────

  describe("updateAnnotation", () => {
    it("updates the content of an annotation and returns the updated annotation", () => {
      const ann = createAnnotation("user1", "conv1", "msg1", "comment", "original content");
      const updated = updateAnnotation(ann.id, "user1", "revised content");
      expect(updated.content).toBe("revised content");
    });

    it("the updated content is persisted in the store", () => {
      const ann = createAnnotation("user1", "conv1", "msg1", "comment", "original");
      updateAnnotation(ann.id, "user1", "updated");
      const stored = getAnnotationsForMessage("msg1");
      expect(stored[0].content).toBe("updated");
    });

    it("returns the same annotation object with matching id", () => {
      const ann = createAnnotation("user1", "conv1", "msg1", "comment", "text");
      const updated = updateAnnotation(ann.id, "user1", "new text");
      expect(updated.id).toBe(ann.id);
    });

    it('throws "not found" error when the annotation id does not exist', () => {
      expect(() => updateAnnotation("nonexistent-id", "user1", "content")).toThrow("not found");
    });

    it('throws "Only the annotation owner can update it" when userId does not match', () => {
      const ann = createAnnotation("user1", "conv1", "msg1", "comment", "mine");
      expect(() => updateAnnotation(ann.id, "user2", "hijack")).toThrow(
        "Only the annotation owner can update it"
      );
    });
  });

  // ─── cross-entity scenarios ───────────────────────────────────────────────

  describe("multiple annotations across conversations and messages", () => {
    it("correctly separates annotations across conversations", () => {
      createAnnotation("user1", "convA", "msgA1", "highlight", "in A");
      createAnnotation("user1", "convA", "msgA2", "comment", "also in A");
      createAnnotation("user1", "convB", "msgB1", "flag", "in B");
      createAnnotation("user2", "convB", "msgB1", "bookmark", "user2 in B");

      expect(getAnnotationsForConversation("convA")).toHaveLength(2);
      expect(getAnnotationsForConversation("convB")).toHaveLength(2);
    });

    it("correctly separates annotations across messages within the same conversation", () => {
      createAnnotation("user1", "conv1", "msg1", "highlight", "msg1 ann");
      createAnnotation("user1", "conv1", "msg2", "comment", "msg2 ann");

      expect(getAnnotationsForMessage("msg1")).toHaveLength(1);
      expect(getAnnotationsForMessage("msg2")).toHaveLength(1);
    });

    it("getUserAnnotations returns only the requesting user's annotations across all conversations", () => {
      createAnnotation("user1", "convA", "msgA1", "highlight", "u1-1");
      createAnnotation("user2", "convA", "msgA1", "comment", "u2-1");
      createAnnotation("user1", "convB", "msgB1", "bookmark", "u1-2");
      createAnnotation("user2", "convB", "msgB1", "flag", "u2-2");

      expect(getUserAnnotations("user1")).toHaveLength(2);
      expect(getUserAnnotations("user2")).toHaveLength(2);
    });
  });
});
