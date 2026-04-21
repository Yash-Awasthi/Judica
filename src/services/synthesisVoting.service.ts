/**
 * Synthesis Voting service.
 *
 * Democratic consensus voting on AI verdicts within deliberations.
 * Users can create voting sessions, cast votes, and tally results.
 */

import crypto from "crypto";
import logger from "../lib/logger.js";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface VotingOption {
  id: string;
  label: string;
  description: string;
}

export type VotingStatus = "open" | "closed";

export interface VotingSession {
  id: string;
  deliberationId: string;
  userId: string;
  options: VotingOption[];
  votes: Map<string, string>; // userId → optionId
  status: VotingStatus;
  createdAt: Date;
  closedAt: Date | null;
}

export interface SessionResults {
  tally: Record<string, number>;
  winner: VotingOption | null;
  totalVotes: number;
}

// ─── In-memory store ────────────────────────────────────────────────────────

// P27-04: Cap sessions Map to prevent unbounded memory growth
const MAX_VOTING_SESSIONS = 2000;
const sessions = new Map<string, VotingSession>();

// ─── Core Functions ─────────────────────────────────────────────────────────

export function createVotingSession(
  deliberationId: string,
  userId: string,
  options: Omit<VotingOption, "id">[],
): VotingSession {
  if (options.length < 2) {
    throw new Error("Voting session requires at least 2 options");
  }
  const id = crypto.randomBytes(12).toString("hex");
  const fullOptions: VotingOption[] = options.map((o) => ({
    ...o,
    id: crypto.randomBytes(6).toString("hex"),
  }));
  const session: VotingSession = {
    id,
    deliberationId,
    userId,
    options: fullOptions,
    votes: new Map(),
    status: "open",
    createdAt: new Date(),
    closedAt: null,
  };
  // P27-04: Evict oldest closed session if map is full
  if (sessions.size >= MAX_VOTING_SESSIONS) {
    for (const [sid, s] of sessions) {
      if (s.status === "closed") {
        sessions.delete(sid);
        break;
      }
    }
  }
  sessions.set(id, session);
  logger.info({ sessionId: id, deliberationId }, "Created voting session");
  return session;
}

export function castVote(sessionId: string, userId: string, optionId: string): void {
  const session = sessions.get(sessionId);
  if (!session) {
    throw new Error(`Voting session '${sessionId}' not found`);
  }
  if (session.status !== "open") {
    throw new Error("Voting session is closed");
  }
  const validOption = session.options.find((o) => o.id === optionId);
  if (!validOption) {
    throw new Error(`Option '${optionId}' not found in session`);
  }
  session.votes.set(userId, optionId);
  logger.info({ sessionId, userId, optionId }, "Vote cast");
}

export function getSessionResults(sessionId: string): SessionResults {
  const session = sessions.get(sessionId);
  if (!session) {
    throw new Error(`Voting session '${sessionId}' not found`);
  }
  const tally: Record<string, number> = {};
  for (const opt of session.options) {
    tally[opt.id] = 0;
  }
  for (const optionId of session.votes.values()) {
    tally[optionId] = (tally[optionId] || 0) + 1;
  }
  const totalVotes = session.votes.size;
  let winner: VotingOption | null = null;
  let maxVotes = 0;
  let tie = false;
  for (const opt of session.options) {
    if (tally[opt.id] > maxVotes) {
      maxVotes = tally[opt.id];
      winner = opt;
      tie = false;
    } else if (tally[opt.id] === maxVotes && maxVotes > 0) {
      tie = true;
    }
  }
  return { tally, winner: tie ? null : winner, totalVotes };
}

export function closeSession(sessionId: string, userId: string): VotingSession {
  const session = sessions.get(sessionId);
  if (!session) {
    throw new Error(`Voting session '${sessionId}' not found`);
  }
  if (session.userId !== userId) {
    throw new Error("Only the session creator can close it");
  }
  session.status = "closed";
  session.closedAt = new Date();
  logger.info({ sessionId }, "Closed voting session");
  return session;
}

export function getSession(sessionId: string): VotingSession | undefined {
  return sessions.get(sessionId);
}

export function listSessionsForDeliberation(deliberationId: string): VotingSession[] {
  return Array.from(sessions.values()).filter((s) => s.deliberationId === deliberationId);
}

// ─── Reset (for tests) ─────────────────────────────────────────────────────

export function _reset(): void {
  sessions.clear();
}
