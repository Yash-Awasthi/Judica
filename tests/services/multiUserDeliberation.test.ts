import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/lib/logger.js", () => ({
  default: {
    info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), child: vi.fn().mockReturnThis(),
  },
}));

import {
  createSession,
  joinSession,
  leaveSession,
  sendMessage,
  getSession,
  listActiveSessions,
  closeSession,
  _reset,
} from "../../src/services/multiUserDeliberation.service.js";

describe("multiUserDeliberation.service", () => {
  beforeEach(() => {
    _reset();
  });

  describe("createSession", () => {
    it("creates a session with host as first participant", () => {
      const session = createSession("host1", "delib1");
      expect(session.id).toBeTruthy();
      expect(session.hostUserId).toBe("host1");
      expect(session.deliberationId).toBe("delib1");
      expect(session.participants.has("host1")).toBe(true);
      expect(session.maxParticipants).toBe(5);
      expect(session.status).toBe("waiting");
      expect(session.messages).toHaveLength(0);
    });

    it("accepts custom maxParticipants", () => {
      const session = createSession("host1", "delib1", 10);
      expect(session.maxParticipants).toBe(10);
    });

    it("throws if maxParticipants out of range", () => {
      expect(() => createSession("host1", "delib1", 1)).toThrow("between 2 and 10");
      expect(() => createSession("host1", "delib1", 11)).toThrow("between 2 and 10");
    });
  });

  describe("joinSession", () => {
    it("adds user to session and activates when 2+ users", () => {
      const session = createSession("host1", "delib1");
      const updated = joinSession(session.id, "user2");
      expect(updated.participants.has("user2")).toBe(true);
      expect(updated.status).toBe("active");
    });

    it("throws if user already in session", () => {
      const session = createSession("host1", "delib1");
      expect(() => joinSession(session.id, "host1")).toThrow("already in session");
    });

    it("throws if session is full", () => {
      const session = createSession("host1", "delib1", 2);
      joinSession(session.id, "user2");
      expect(() => joinSession(session.id, "user3")).toThrow("full");
    });

    it("throws if session is completed", () => {
      const session = createSession("host1", "delib1");
      closeSession(session.id, "host1");
      expect(() => joinSession(session.id, "user2")).toThrow("completed");
    });

    it("throws if session not found", () => {
      expect(() => joinSession("nope", "user1")).toThrow("not found");
    });
  });

  describe("leaveSession", () => {
    it("removes user from session", () => {
      const session = createSession("host1", "delib1");
      joinSession(session.id, "user2");
      const updated = leaveSession(session.id, "user2");
      expect(updated.participants.has("user2")).toBe(false);
    });

    it("completes session when last user leaves", () => {
      const session = createSession("host1", "delib1");
      const updated = leaveSession(session.id, "host1");
      expect(updated.status).toBe("completed");
    });

    it("throws if user not in session", () => {
      const session = createSession("host1", "delib1");
      expect(() => leaveSession(session.id, "stranger")).toThrow("not in session");
    });
  });

  describe("sendMessage", () => {
    it("sends a chat message", () => {
      const session = createSession("host1", "delib1");
      const msg = sendMessage(session.id, "host1", "Hello!");
      expect(msg.userId).toBe("host1");
      expect(msg.type).toBe("chat");
      expect(msg.content).toBe("Hello!");
      expect(getSession(session.id)!.messages).toHaveLength(1);
    });

    it("sends a suggestion message", () => {
      const session = createSession("host1", "delib1");
      const msg = sendMessage(session.id, "host1", "How about X?", "suggestion");
      expect(msg.type).toBe("suggestion");
    });

    it("throws if user not in session", () => {
      const session = createSession("host1", "delib1");
      expect(() => sendMessage(session.id, "stranger", "Hi")).toThrow("not in session");
    });

    it("throws if session is completed", () => {
      const session = createSession("host1", "delib1");
      closeSession(session.id, "host1");
      expect(() => sendMessage(session.id, "host1", "Hi")).toThrow("completed");
    });
  });

  describe("listActiveSessions", () => {
    it("lists waiting and active sessions", () => {
      createSession("host1", "delib1");
      const s2 = createSession("host2", "delib2");
      joinSession(s2.id, "user3");
      const s3 = createSession("host3", "delib3");
      closeSession(s3.id, "host3");

      const active = listActiveSessions();
      expect(active).toHaveLength(2);
    });
  });

  describe("closeSession", () => {
    it("closes a session by host", () => {
      const session = createSession("host1", "delib1");
      const closed = closeSession(session.id, "host1");
      expect(closed.status).toBe("completed");
    });

    it("throws if not the host", () => {
      const session = createSession("host1", "delib1");
      joinSession(session.id, "user2");
      expect(() => closeSession(session.id, "user2")).toThrow("host");
    });
  });
});
