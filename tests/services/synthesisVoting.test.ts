import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/lib/logger.js", () => ({
  default: {
    info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), child: vi.fn().mockReturnThis(),
  },
}));

import {
  createVotingSession,
  castVote,
  getSessionResults,
  closeSession,
  getSession,
  listSessionsForDeliberation,
  _reset,
} from "../../src/services/synthesisVoting.service.js";

describe("synthesisVoting.service", () => {
  beforeEach(() => {
    _reset();
  });

  const twoOptions = [
    { label: "Option A", description: "First option" },
    { label: "Option B", description: "Second option" },
  ];

  describe("createVotingSession", () => {
    it("creates a session with options", () => {
      const session = createVotingSession("delib1", "user1", twoOptions);
      expect(session.id).toBeTruthy();
      expect(session.deliberationId).toBe("delib1");
      expect(session.userId).toBe("user1");
      expect(session.options).toHaveLength(2);
      expect(session.status).toBe("open");
      expect(session.closedAt).toBeNull();
    });

    it("assigns ids to options", () => {
      const session = createVotingSession("delib1", "user1", twoOptions);
      for (const opt of session.options) {
        expect(opt.id).toBeTruthy();
      }
    });

    it("throws if fewer than 2 options", () => {
      expect(() =>
        createVotingSession("delib1", "user1", [{ label: "Only", description: "one" }]),
      ).toThrow("at least 2");
    });
  });

  describe("castVote", () => {
    it("records a vote", () => {
      const session = createVotingSession("delib1", "user1", twoOptions);
      castVote(session.id, "voter1", session.options[0].id);
      const results = getSessionResults(session.id);
      expect(results.totalVotes).toBe(1);
    });

    it("allows changing vote (one per user)", () => {
      const session = createVotingSession("delib1", "user1", twoOptions);
      castVote(session.id, "voter1", session.options[0].id);
      castVote(session.id, "voter1", session.options[1].id);
      const results = getSessionResults(session.id);
      expect(results.totalVotes).toBe(1);
      expect(results.tally[session.options[1].id]).toBe(1);
      expect(results.tally[session.options[0].id]).toBe(0);
    });

    it("throws on invalid option", () => {
      const session = createVotingSession("delib1", "user1", twoOptions);
      expect(() => castVote(session.id, "voter1", "bad")).toThrow("not found");
    });

    it("throws on closed session", () => {
      const session = createVotingSession("delib1", "user1", twoOptions);
      closeSession(session.id, "user1");
      expect(() => castVote(session.id, "voter1", session.options[0].id)).toThrow("closed");
    });

    it("throws on non-existent session", () => {
      expect(() => castVote("nope", "voter1", "opt")).toThrow("not found");
    });
  });

  describe("getSessionResults", () => {
    it("returns correct tally and winner", () => {
      const session = createVotingSession("delib1", "user1", twoOptions);
      castVote(session.id, "v1", session.options[0].id);
      castVote(session.id, "v2", session.options[0].id);
      castVote(session.id, "v3", session.options[1].id);

      const results = getSessionResults(session.id);
      expect(results.totalVotes).toBe(3);
      expect(results.tally[session.options[0].id]).toBe(2);
      expect(results.tally[session.options[1].id]).toBe(1);
      expect(results.winner!.id).toBe(session.options[0].id);
    });

    it("returns null winner on tie", () => {
      const session = createVotingSession("delib1", "user1", twoOptions);
      castVote(session.id, "v1", session.options[0].id);
      castVote(session.id, "v2", session.options[1].id);

      const results = getSessionResults(session.id);
      expect(results.winner).toBeNull();
    });
  });

  describe("closeSession", () => {
    it("closes a session by creator", () => {
      const session = createVotingSession("delib1", "user1", twoOptions);
      const closed = closeSession(session.id, "user1");
      expect(closed.status).toBe("closed");
      expect(closed.closedAt).toBeInstanceOf(Date);
    });

    it("throws if not the creator", () => {
      const session = createVotingSession("delib1", "user1", twoOptions);
      expect(() => closeSession(session.id, "user2")).toThrow("creator");
    });
  });

  describe("getSession & listSessionsForDeliberation", () => {
    it("gets a session by id", () => {
      const session = createVotingSession("delib1", "user1", twoOptions);
      expect(getSession(session.id)).toBeDefined();
      expect(getSession("nope")).toBeUndefined();
    });

    it("lists sessions for a deliberation", () => {
      createVotingSession("delib1", "user1", twoOptions);
      createVotingSession("delib1", "user1", twoOptions);
      createVotingSession("delib2", "user1", twoOptions);

      expect(listSessionsForDeliberation("delib1")).toHaveLength(2);
      expect(listSessionsForDeliberation("delib2")).toHaveLength(1);
    });
  });
});
