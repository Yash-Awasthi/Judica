/**
 * Multi-User Deliberation service.
 *
 * Shared council sessions for 2-10 users to collaborate on deliberations.
 * Users can join, send messages, and work together in real time.
 */

import crypto from "crypto";
import logger from "../lib/logger.js";

// ─── Types ──────────────────────────────────────────────────────────────────

export type SessionStatus = "waiting" | "active" | "completed";
export type MessageType = "chat" | "suggestion" | "objection";

export interface SessionMessage {
  userId: string;
  type: MessageType;
  content: string;
  timestamp: Date;
}

export interface SharedSession {
  id: string;
  deliberationId: string;
  hostUserId: string;
  participants: Set<string>;
  maxParticipants: number;
  status: SessionStatus;
  messages: SessionMessage[];
  createdAt: Date;
}

// ─── In-memory store ────────────────────────────────────────────────────────

// P26-02: Cap sessions Map to prevent unbounded memory growth
const MAX_SESSIONS = 1000;
const sessions = new Map<string, SharedSession>();

// ─── Core Functions ─────────────────────────────────────────────────────────

export function createSession(
  hostUserId: string,
  deliberationId: string,
  maxParticipants: number = 5,
): SharedSession {
  if (maxParticipants < 2 || maxParticipants > 10) {
    throw new Error("maxParticipants must be between 2 and 10");
  }
  const id = crypto.randomBytes(12).toString("hex");
  const session: SharedSession = {
    id,
    deliberationId,
    hostUserId,
    participants: new Set([hostUserId]),
    maxParticipants,
    status: "waiting",
    messages: [],
    createdAt: new Date(),
  };
  // P26-02: Evict oldest completed session if map is full
  if (sessions.size >= MAX_SESSIONS) {
    for (const [sid, s] of sessions) {
      if (s.status === "completed") {
        sessions.delete(sid);
        break;
      }
    }
  }
  sessions.set(id, session);
  logger.info({ sessionId: id, hostUserId, deliberationId }, "Created shared session");
  return session;
}

export function joinSession(sessionId: string, userId: string): SharedSession {
  const session = sessions.get(sessionId);
  if (!session) {
    throw new Error(`Session '${sessionId}' not found`);
  }
  if (session.status === "completed") {
    throw new Error("Session is completed");
  }
  if (session.participants.has(userId)) {
    throw new Error("User already in session");
  }
  if (session.participants.size >= session.maxParticipants) {
    throw new Error("Session is full");
  }
  session.participants.add(userId);
  if (session.participants.size >= 2 && session.status === "waiting") {
    session.status = "active";
  }
  logger.info({ sessionId, userId }, "User joined shared session");
  return session;
}

export function leaveSession(sessionId: string, userId: string): SharedSession {
  const session = sessions.get(sessionId);
  if (!session) {
    throw new Error(`Session '${sessionId}' not found`);
  }
  if (!session.participants.has(userId)) {
    throw new Error("User not in session");
  }
  session.participants.delete(userId);
  if (session.participants.size === 0) {
    session.status = "completed";
  }
  logger.info({ sessionId, userId }, "User left shared session");
  return session;
}

export function sendMessage(
  sessionId: string,
  userId: string,
  content: string,
  type: MessageType = "chat",
): SessionMessage {
  const session = sessions.get(sessionId);
  if (!session) {
    throw new Error(`Session '${sessionId}' not found`);
  }
  if (!session.participants.has(userId)) {
    throw new Error("User not in session");
  }
  if (session.status === "completed") {
    throw new Error("Session is completed");
  }
  if (content.length > 10000) {
    throw new Error("Message content exceeds 10,000 character limit");
  }
  const message: SessionMessage = {
    userId,
    type,
    content,
    timestamp: new Date(),
  };
  session.messages.push(message);
  logger.debug({ sessionId, userId, type }, "Message sent in shared session");
  return message;
}

export function getSession(sessionId: string): SharedSession | undefined {
  return sessions.get(sessionId);
}

export function listActiveSessions(): SharedSession[] {
  return Array.from(sessions.values()).filter(
    (s) => s.status === "active" || s.status === "waiting",
  );
}

export function closeSession(sessionId: string, userId: string): SharedSession {
  const session = sessions.get(sessionId);
  if (!session) {
    throw new Error(`Session '${sessionId}' not found`);
  }
  if (session.hostUserId !== userId) {
    throw new Error("Only the host can close the session");
  }
  session.status = "completed";
  logger.info({ sessionId }, "Closed shared session");
  return session;
}

/**
 * Clean up old completed sessions.
 */
export function cleanupSessions(maxAgeMs: number = 4 * 60 * 60 * 1000): number {
  const cutoff = Date.now() - maxAgeMs;
  let removed = 0;
  for (const [id, session] of sessions.entries()) {
    if (session.status === "completed" && session.createdAt.getTime() < cutoff) {
      sessions.delete(id);
      removed++;
    }
  }
  return removed;
}

// Auto-cleanup completed sessions every 15 minutes
setInterval(() => {
  const removed = cleanupSessions();
  if (removed > 0) {
    logger.info({ removed }, "Auto-cleaned completed shared sessions");
  }
}, 15 * 60 * 1000).unref();

// ─── Reset (for tests) ─────────────────────────────────────────────────────

export function _reset(): void {
  sessions.clear();
}
