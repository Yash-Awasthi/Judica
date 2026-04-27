import { describe, it, expect, vi, beforeEach } from "vitest";

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
    vi.clearAllMocks();
  });

  const twoOptions = [
    { label: "Option A", description: "First choice" },
    { label: "Option B", description: "Second choice" },
  ];

  const threeOptions = [
    { label: "Option A", description: "First choice" },
    { label: "Option B", description: "Second choice" },
    { label: "Option C", description: "Third choice" },
  ];

  // ─── createVotingSession ─────────────────────────────────────────────────

  describe("createVotingSession", () => {
    it("returns a session with a non-empty id", () => {
      const session = createVotingSession("delib1", "user1", twoOptions);
      expect(session.id).toBeTruthy();
      expect(typeof session.id).toBe("string");
    });

    it("returns a session with the correct deliberationId", () => {
      const session = createVotingSession("delib1", "user1", twoOptions);
      expect(session.deliberationId).toBe("delib1");
    });

    it("returns a session with the correct userId (creator)", () => {
      const session = createVotingSession("delib1", "user1", twoOptions);
      expect(session.userId).toBe("user1");
    });

    it("returns a session with status 'open'", () => {
      const session = createVotingSession("delib1", "user1", twoOptions);
      expect(session.status).toBe("open");
    });

    it("returns a session with closedAt null", () => {
      const session = createVotingSession("delib1", "user1", twoOptions);
      expect(session.closedAt).toBeNull();
    });

    it("assigns auto-generated ids to each option", () => {
      const session = createVotingSession("delib1", "user1", twoOptions);
      expect(session.options).toHaveLength(2);
      for (const opt of session.options) {
        expect(opt.id).toBeTruthy();
      }
    });

    it("preserves option label and description", () => {
      const session = createVotingSession("delib1", "user1", twoOptions);
      expect(session.options[0].label).toBe("Option A");
      expect(session.options[1].description).toBe("Second choice");
    });

    it("throws when fewer than 2 options are provided", () => {
      expect(() =>
        createVotingSession("delib1", "user1", [{ label: "Lone", description: "only one" }]),
      ).toThrow("at least 2");
    });

    it("throws when 0 options are provided", () => {
      expect(() => createVotingSession("delib1", "user1", [])).toThrow();
    });

    it("creates session with a createdAt Date", () => {
      const session = createVotingSession("delib1", "user1", twoOptions);
      expect(session.createdAt).toBeInstanceOf(Date);
    });
  });

  // ─── castVote ────────────────────────────────────────────────────────────

  describe("castVote", () => {
    it("records a vote for a valid user and optionId", () => {
      const session = createVotingSession("delib1", "user1", twoOptions);
      castVote(session.id, "voter1", session.options[0].id);
      const results = getSessionResults(session.id);
      expect(results.totalVotes).toBe(1);
    });

    it("throws when session is not found", () => {
      expect(() => castVote("nonexistent", "voter1", "opt1")).toThrow("not found");
    });

    it("throws when session is closed", () => {
      const session = createVotingSession("delib1", "user1", twoOptions);
      closeSession(session.id, "user1");
      expect(() => castVote(session.id, "voter1", session.options[0].id)).toThrow("closed");
    });

    it("throws when optionId is not valid for the session", () => {
      const session = createVotingSession("delib1", "user1", twoOptions);
      expect(() => castVote(session.id, "voter1", "bad-option-id")).toThrow("not found");
    });

    it("replaces the existing vote when the same user votes again", () => {
      const session = createVotingSession("delib1", "user1", twoOptions);
      castVote(session.id, "voter1", session.options[0].id);
      castVote(session.id, "voter1", session.options[1].id);
      const results = getSessionResults(session.id);
      expect(results.totalVotes).toBe(1);
      expect(results.tally[session.options[1].id]).toBe(1);
      expect(results.tally[session.options[0].id]).toBe(0);
    });

    it("counts votes from different users independently", () => {
      const session = createVotingSession("delib1", "user1", twoOptions);
      castVote(session.id, "voter1", session.options[0].id);
      castVote(session.id, "voter2", session.options[0].id);
      const results = getSessionResults(session.id);
      expect(results.totalVotes).toBe(2);
    });
  });

  // ─── getSessionResults ────────────────────────────────────────────────────

  describe("getSessionResults", () => {
    it("returns a tally with a count for every option", () => {
      const session = createVotingSession("delib1", "user1", twoOptions);
      const results = getSessionResults(session.id);
      expect(Object.keys(results.tally)).toHaveLength(2);
      for (const opt of session.options) {
        expect(results.tally[opt.id]).toBe(0);
      }
    });

    it("returns the correct tally after voting", () => {
      const session = createVotingSession("delib1", "user1", twoOptions);
      castVote(session.id, "v1", session.options[0].id);
      castVote(session.id, "v2", session.options[0].id);
      castVote(session.id, "v3", session.options[1].id);
      const results = getSessionResults(session.id);
      expect(results.tally[session.options[0].id]).toBe(2);
      expect(results.tally[session.options[1].id]).toBe(1);
    });

    it("returns the winner as the option with the most votes", () => {
      const session = createVotingSession("delib1", "user1", twoOptions);
      castVote(session.id, "v1", session.options[0].id);
      castVote(session.id, "v2", session.options[0].id);
      castVote(session.id, "v3", session.options[1].id);
      const results = getSessionResults(session.id);
      expect(results.winner).not.toBeNull();
      expect(results.winner!.id).toBe(session.options[0].id);
    });

    it("returns winner as null when there is a tie", () => {
      const session = createVotingSession("delib1", "user1", twoOptions);
      castVote(session.id, "v1", session.options[0].id);
      castVote(session.id, "v2", session.options[1].id);
      const results = getSessionResults(session.id);
      expect(results.winner).toBeNull();
    });

    it("returns winner as null when no votes have been cast", () => {
      const session = createVotingSession("delib1", "user1", twoOptions);
      const results = getSessionResults(session.id);
      expect(results.winner).toBeNull();
    });

    it("returns correct totalVotes count", () => {
      const session = createVotingSession("delib1", "user1", threeOptions);
      castVote(session.id, "v1", session.options[0].id);
      castVote(session.id, "v2", session.options[1].id);
      castVote(session.id, "v3", session.options[2].id);
      const results = getSessionResults(session.id);
      expect(results.totalVotes).toBe(3);
    });

    it("throws when session is not found", () => {
      expect(() => getSessionResults("nonexistent")).toThrow("not found");
    });
  });

  // ─── closeSession ─────────────────────────────────────────────────────────

  describe("closeSession", () => {
    it("sets status to 'closed' when called by the creator", () => {
      const session = createVotingSession("delib1", "user1", twoOptions);
      const closed = closeSession(session.id, "user1");
      expect(closed.status).toBe("closed");
    });

    it("sets closedAt to a Date when closed", () => {
      const session = createVotingSession("delib1", "user1", twoOptions);
      const closed = closeSession(session.id, "user1");
      expect(closed.closedAt).toBeInstanceOf(Date);
    });

    it("throws when the wrong userId attempts to close the session", () => {
      const session = createVotingSession("delib1", "user1", twoOptions);
      expect(() => closeSession(session.id, "intruder")).toThrow("creator");
    });

    it("throws when session is not found", () => {
      expect(() => closeSession("nonexistent", "user1")).toThrow("not found");
    });
  });

  // ─── getSession ───────────────────────────────────────────────────────────

  describe("getSession", () => {
    it("returns undefined for an unknown session id", () => {
      expect(getSession("unknown")).toBeUndefined();
    });

    it("returns the session after creation", () => {
      const session = createVotingSession("delib1", "user1", twoOptions);
      const found = getSession(session.id);
      expect(found).toBeDefined();
      expect(found!.id).toBe(session.id);
    });
  });

  // ─── listSessionsForDeliberation ─────────────────────────────────────────

  describe("listSessionsForDeliberation", () => {
    it("returns all sessions matching the deliberationId", () => {
      createVotingSession("delib1", "user1", twoOptions);
      createVotingSession("delib1", "user2", twoOptions);
      const results = listSessionsForDeliberation("delib1");
      expect(results).toHaveLength(2);
    });

    it("does not return sessions for other deliberations", () => {
      createVotingSession("delib1", "user1", twoOptions);
      createVotingSession("delib2", "user1", twoOptions);
      const results = listSessionsForDeliberation("delib1");
      expect(results).toHaveLength(1);
      expect(results[0].deliberationId).toBe("delib1");
    });

    it("returns an empty array when no sessions match", () => {
      expect(listSessionsForDeliberation("delib-none")).toEqual([]);
    });
  });

  // ─── multiple votes from different users ─────────────────────────────────

  describe("multiple votes from different users", () => {
    it("each user's vote is recorded independently", () => {
      const session = createVotingSession("delib1", "user1", threeOptions);
      castVote(session.id, "v1", session.options[0].id);
      castVote(session.id, "v2", session.options[1].id);
      castVote(session.id, "v3", session.options[0].id);
      castVote(session.id, "v4", session.options[2].id);
      const results = getSessionResults(session.id);
      expect(results.totalVotes).toBe(4);
      expect(results.tally[session.options[0].id]).toBe(2);
      expect(results.tally[session.options[1].id]).toBe(1);
      expect(results.tally[session.options[2].id]).toBe(1);
      expect(results.winner!.id).toBe(session.options[0].id);
    });
  });
});
