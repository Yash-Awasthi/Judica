import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../src/lib/logger.js", () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })),
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
    _reset();
    vi.clearAllMocks();
  });

  afterEach(() => {
    _reset();
    vi.useRealTimers();
  });

  // ─── updatePresence ──────────────────────────────────────────────────────

  describe("updatePresence", () => {
    it("creates a new entry with default cursor {line:0, column:0}", () => {
      const state = updatePresence("u1", "sess1", {});
      expect(state.cursor).toEqual({ line: 0, column: 0 });
    });

    it("creates a new entry with isTyping defaulting to false", () => {
      const state = updatePresence("u1", "sess1", {});
      expect(state.isTyping).toBe(false);
    });

    it("creates a new entry with userId and sessionId set correctly", () => {
      const state = updatePresence("u1", "sess1", {});
      expect(state.userId).toBe("u1");
      expect(state.sessionId).toBe("sess1");
    });

    it("creates an entry with provided cursor values", () => {
      const state = updatePresence("u1", "sess1", { cursor: { line: 3, column: 7 } });
      expect(state.cursor).toEqual({ line: 3, column: 7 });
    });

    it("creates an entry with provided isTyping and metadata", () => {
      const state = updatePresence("u1", "sess1", {
        isTyping: true,
        metadata: { color: "#aabbcc", name: "Alice" },
      });
      expect(state.isTyping).toBe(true);
      expect(state.metadata).toEqual({ color: "#aabbcc", name: "Alice" });
    });

    it("updates an existing entry's cursor", () => {
      updatePresence("u1", "sess1", { cursor: { line: 1, column: 2 } });
      const updated = updatePresence("u1", "sess1", { cursor: { line: 10, column: 20 } });
      expect(updated.cursor).toEqual({ line: 10, column: 20 });
    });

    it("preserves existing cursor when updating only isTyping", () => {
      updatePresence("u1", "sess1", { cursor: { line: 5, column: 5 } });
      const updated = updatePresence("u1", "sess1", { isTyping: true });
      expect(updated.cursor).toEqual({ line: 5, column: 5 });
    });

    it("preserves existing metadata when updating only cursor", () => {
      updatePresence("u1", "sess1", { metadata: { color: "#ff0000", name: "Bob" } });
      const updated = updatePresence("u1", "sess1", { cursor: { line: 0, column: 1 } });
      expect(updated.metadata).toEqual({ color: "#ff0000", name: "Bob" });
    });

    it("returns the updated PresenceState", () => {
      const state = updatePresence("u1", "sess1", { cursor: { line: 2, column: 4 } });
      expect(state).toMatchObject({
        userId: "u1",
        sessionId: "sess1",
        cursor: { line: 2, column: 4 },
        isTyping: false,
      });
      expect(state.lastActivity).toBeInstanceOf(Date);
    });

    it("sets lastActivity to current time on creation", () => {
      vi.useFakeTimers();
      const now = new Date("2025-06-01T12:00:00Z");
      vi.setSystemTime(now);
      const state = updatePresence("u1", "sess1", {});
      expect(state.lastActivity.getTime()).toBe(now.getTime());
    });

    it("cursor can include a selection range", () => {
      const selection = { startLine: 1, startCol: 0, endLine: 3, endCol: 5 };
      const state = updatePresence("u1", "sess1", {
        cursor: { line: 1, column: 0, selection },
      });
      expect(state.cursor.selection).toEqual(selection);
    });
  });

  // ─── getPresence ─────────────────────────────────────────────────────────

  describe("getPresence", () => {
    it("returns all entries for a session", () => {
      updatePresence("u1", "sess1", {});
      updatePresence("u2", "sess1", {});
      const result = getPresence("sess1");
      expect(result).toHaveLength(2);
      const userIds = result.map((s) => s.userId);
      expect(userIds).toContain("u1");
      expect(userIds).toContain("u2");
    });

    it("does not include entries from other sessions", () => {
      updatePresence("u1", "sess1", {});
      updatePresence("u2", "sess2", {});
      const result = getPresence("sess1");
      expect(result).toHaveLength(1);
      expect(result[0].userId).toBe("u1");
    });

    it("returns empty array for unknown session", () => {
      const result = getPresence("unknown-session");
      expect(result).toEqual([]);
    });
  });

  // ─── getUserPresence ─────────────────────────────────────────────────────

  describe("getUserPresence", () => {
    it("returns the state for a known user/session pair", () => {
      updatePresence("u1", "sess1", { cursor: { line: 4, column: 9 } });
      const state = getUserPresence("sess1", "u1");
      expect(state).toBeDefined();
      expect(state!.cursor).toEqual({ line: 4, column: 9 });
    });

    it("returns undefined for unknown session", () => {
      expect(getUserPresence("no-session", "u1")).toBeUndefined();
    });

    it("returns undefined for unknown user in an existing session", () => {
      updatePresence("u1", "sess1", {});
      expect(getUserPresence("sess1", "no-user")).toBeUndefined();
    });
  });

  // ─── removePresence ──────────────────────────────────────────────────────

  describe("removePresence", () => {
    it("returns true when entry existed and removes it", () => {
      updatePresence("u1", "sess1", {});
      const result = removePresence("u1", "sess1");
      expect(result).toBe(true);
      expect(getUserPresence("sess1", "u1")).toBeUndefined();
    });

    it("returns false when entry did not exist", () => {
      const result = removePresence("ghost", "sess1");
      expect(result).toBe(false);
    });

    it("only removes the specified user, not others in the same session", () => {
      updatePresence("u1", "sess1", {});
      updatePresence("u2", "sess1", {});
      removePresence("u1", "sess1");
      expect(getUserPresence("sess1", "u2")).toBeDefined();
    });
  });

  // ─── setTyping ───────────────────────────────────────────────────────────

  describe("setTyping", () => {
    it("sets isTyping to true on an existing presence entry", () => {
      updatePresence("u1", "sess1", {});
      setTyping("u1", "sess1", true);
      expect(getUserPresence("sess1", "u1")!.isTyping).toBe(true);
    });

    it("sets isTyping to false on an existing presence entry", () => {
      updatePresence("u1", "sess1", { isTyping: true });
      setTyping("u1", "sess1", false);
      expect(getUserPresence("sess1", "u1")!.isTyping).toBe(false);
    });

    it("creates a presence entry when user is not in presenceMap", () => {
      setTyping("new-user", "sess1", true);
      const state = getUserPresence("sess1", "new-user");
      expect(state).toBeDefined();
      expect(state!.isTyping).toBe(true);
    });

    it("auto-clears isTyping after 5 seconds via timer", () => {
      vi.useFakeTimers();
      updatePresence("u1", "sess1", {});
      setTyping("u1", "sess1", true);
      expect(getUserPresence("sess1", "u1")!.isTyping).toBe(true);
      vi.advanceTimersByTime(5001);
      expect(getUserPresence("sess1", "u1")!.isTyping).toBe(false);
    });

    it("does not auto-clear when setTyping is called with false", () => {
      vi.useFakeTimers();
      updatePresence("u1", "sess1", {});
      setTyping("u1", "sess1", false);
      vi.advanceTimersByTime(10000);
      // Should still be false (no timer mishap)
      expect(getUserPresence("sess1", "u1")!.isTyping).toBe(false);
    });
  });

  // ─── heartbeat ───────────────────────────────────────────────────────────

  describe("heartbeat", () => {
    it("updates lastActivity timestamp on an existing entry", () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2025-01-01T00:00:00Z"));
      updatePresence("u1", "sess1", {});
      const before = getUserPresence("sess1", "u1")!.lastActivity.getTime();

      vi.setSystemTime(new Date("2025-01-01T00:00:30Z"));
      heartbeat("u1", "sess1");
      const after = getUserPresence("sess1", "u1")!.lastActivity.getTime();

      expect(after).toBeGreaterThan(before);
    });

    it("creates an entry when user is not present", () => {
      heartbeat("new-user", "sess1");
      expect(getUserPresence("sess1", "new-user")).toBeDefined();
    });

    it("does not duplicate entries when called multiple times", () => {
      heartbeat("u1", "sess1");
      heartbeat("u1", "sess1");
      expect(getPresence("sess1")).toHaveLength(1);
    });
  });

  // ─── cleanupStale ────────────────────────────────────────────────────────

  describe("cleanupStale", () => {
    it("removes entries older than maxInactiveMs", () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2025-01-01T00:00:00Z"));
      updatePresence("u1", "sess1", {});

      vi.setSystemTime(new Date("2025-01-01T00:02:00Z"));
      cleanupStale(60_000);
      expect(getUserPresence("sess1", "u1")).toBeUndefined();
    });

    it("returns an array of removed keys", () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2025-01-01T00:00:00Z"));
      updatePresence("u1", "sess1", {});

      vi.setSystemTime(new Date("2025-01-01T00:02:00Z"));
      const removed = cleanupStale(60_000);
      expect(removed).toHaveLength(1);
      expect(removed[0]).toContain("sess1");
      expect(removed[0]).toContain("u1");
    });

    it("does NOT remove entries that are still recent", () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2025-01-01T00:00:00Z"));
      updatePresence("u1", "sess1", {});

      vi.setSystemTime(new Date("2025-01-01T00:00:30Z"));
      const removed = cleanupStale(60_000);
      expect(removed).toHaveLength(0);
      expect(getUserPresence("sess1", "u1")).toBeDefined();
    });

    it("returns empty array when there is nothing to clean", () => {
      const removed = cleanupStale(60_000);
      expect(removed).toEqual([]);
    });
  });

  // ─── multi-user session ──────────────────────────────────────────────────

  describe("multiple users in same session", () => {
    it("tracks each user independently", () => {
      updatePresence("u1", "sess1", { cursor: { line: 1, column: 0 } });
      updatePresence("u2", "sess1", { cursor: { line: 5, column: 3 } });
      updatePresence("u3", "sess1", { cursor: { line: 9, column: 1 } });

      expect(getPresence("sess1")).toHaveLength(3);
      expect(getUserPresence("sess1", "u1")!.cursor.line).toBe(1);
      expect(getUserPresence("sess1", "u2")!.cursor.line).toBe(5);
      expect(getUserPresence("sess1", "u3")!.cursor.line).toBe(9);
    });

    it("removing one user leaves others intact", () => {
      updatePresence("u1", "sess1", {});
      updatePresence("u2", "sess1", {});
      removePresence("u1", "sess1");
      expect(getPresence("sess1")).toHaveLength(1);
      expect(getUserPresence("sess1", "u2")).toBeDefined();
    });
  });
});
