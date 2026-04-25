import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../src/lib/logger.js", () => ({
  default: {
    info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), child: vi.fn().mockReturnThis(),
  },
}));

import {
  updatePresence,
  getPresence,
  getUserPresence,
  removePresence,
  setTyping,
  heartbeat,
  cleanupStale,
  _reset,
} from "../../src/services/livePresence.service.js";

describe("livePresence.service", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    _reset();
  });

  afterEach(() => {
    _reset();
    vi.useRealTimers();
  });

  describe("updatePresence", () => {
    it("creates a new presence entry", () => {
      const state = updatePresence("u1", "sess1", {
        cursor: { line: 1, column: 5 },
        metadata: { color: "#ff0000", name: "Alice" },
      });
      expect(state.userId).toBe("u1");
      expect(state.sessionId).toBe("sess1");
      expect(state.cursor).toEqual({ line: 1, column: 5 });
      expect(state.isTyping).toBe(false);
      expect(state.metadata.color).toBe("#ff0000");
    });

    it("updates existing presence entry", () => {
      updatePresence("u1", "sess1", { cursor: { line: 1, column: 0 } });
      const updated = updatePresence("u1", "sess1", { cursor: { line: 5, column: 10 } });
      expect(updated.cursor).toEqual({ line: 5, column: 10 });
    });

    it("preserves existing fields on partial update", () => {
      updatePresence("u1", "sess1", {
        cursor: { line: 1, column: 0 },
        metadata: { color: "#ff0000", name: "Alice" },
      });
      const updated = updatePresence("u1", "sess1", { isTyping: true });
      expect(updated.cursor).toEqual({ line: 1, column: 0 });
      expect(updated.metadata.name).toBe("Alice");
      expect(updated.isTyping).toBe(true);
    });
  });

  describe("getPresence", () => {
    it("returns all users in a session", () => {
      updatePresence("u1", "sess1", { cursor: { line: 0, column: 0 } });
      updatePresence("u2", "sess1", { cursor: { line: 3, column: 2 } });
      updatePresence("u3", "sess2", { cursor: { line: 0, column: 0 } });

      const result = getPresence("sess1");
      expect(result).toHaveLength(2);
    });

    it("returns empty for unknown session", () => {
      expect(getPresence("nope")).toHaveLength(0);
    });
  });

  describe("getUserPresence", () => {
    it("returns specific user presence", () => {
      updatePresence("u1", "sess1", { cursor: { line: 7, column: 3 } });
      const state = getUserPresence("sess1", "u1");
      expect(state).toBeDefined();
      expect(state!.cursor.line).toBe(7);
    });

    it("returns undefined for unknown user", () => {
      expect(getUserPresence("sess1", "nope")).toBeUndefined();
    });
  });

  describe("removePresence", () => {
    it("removes user presence", () => {
      updatePresence("u1", "sess1", { cursor: { line: 0, column: 0 } });
      expect(removePresence("u1", "sess1")).toBe(true);
      expect(getUserPresence("sess1", "u1")).toBeUndefined();
    });

    it("returns false for non-existent entry", () => {
      expect(removePresence("u1", "sess1")).toBe(false);
    });
  });

  describe("setTyping", () => {
    it("sets typing indicator to true", () => {
      updatePresence("u1", "sess1", { cursor: { line: 0, column: 0 } });
      setTyping("u1", "sess1", true);
      const state = getUserPresence("sess1", "u1");
      expect(state!.isTyping).toBe(true);
    });

    it("auto-clears typing after 5 seconds", () => {
      updatePresence("u1", "sess1", { cursor: { line: 0, column: 0 } });
      setTyping("u1", "sess1", true);
      expect(getUserPresence("sess1", "u1")!.isTyping).toBe(true);

      vi.advanceTimersByTime(5001);
      expect(getUserPresence("sess1", "u1")!.isTyping).toBe(false);
    });

    it("auto-creates presence if not existing", () => {
      setTyping("u1", "sess1", true);
      const state = getUserPresence("sess1", "u1");
      expect(state).toBeDefined();
      expect(state!.isTyping).toBe(true);
    });
  });

  describe("heartbeat", () => {
    it("updates lastActivity timestamp", () => {
      vi.setSystemTime(new Date("2025-01-01T00:00:00Z"));
      updatePresence("u1", "sess1", { cursor: { line: 0, column: 0 } });
      const t1 = getUserPresence("sess1", "u1")!.lastActivity.getTime();

      vi.setSystemTime(new Date("2025-01-01T00:01:00Z"));
      heartbeat("u1", "sess1");
      const t2 = getUserPresence("sess1", "u1")!.lastActivity.getTime();
      expect(t2).toBeGreaterThan(t1);
    });

    it("creates presence if not existing", () => {
      heartbeat("u1", "sess1");
      expect(getUserPresence("sess1", "u1")).toBeDefined();
    });
  });

  describe("cleanupStale", () => {
    it("removes inactive users", () => {
      vi.setSystemTime(new Date("2025-01-01T00:00:00Z"));
      updatePresence("u1", "sess1", { cursor: { line: 0, column: 0 } });
      updatePresence("u2", "sess1", { cursor: { line: 0, column: 0 } });

      vi.setSystemTime(new Date("2025-01-01T00:02:00Z"));
      heartbeat("u2", "sess1"); // u2 is still active

      const removed = cleanupStale(60_000);
      expect(removed).toHaveLength(1);
      expect(getUserPresence("sess1", "u1")).toBeUndefined();
      expect(getUserPresence("sess1", "u2")).toBeDefined();
    });

    it("accepts custom maxInactiveMs", () => {
      vi.setSystemTime(new Date("2025-01-01T00:00:00Z"));
      updatePresence("u1", "sess1", { cursor: { line: 0, column: 0 } });

      vi.setSystemTime(new Date("2025-01-01T00:00:10Z"));
      const removed = cleanupStale(5000);
      expect(removed).toHaveLength(1);
    });

    it("returns empty array when nothing to clean", () => {
      updatePresence("u1", "sess1", { cursor: { line: 0, column: 0 } });
      const removed = cleanupStale();
      expect(removed).toHaveLength(0);
    });
  });
});
