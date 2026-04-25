/**
 * Live Presence service.
 *
 * Tracks cursor positions, typing indicators, and online status
 * for users collaborating in shared sessions.
 */

import logger from "../lib/logger.js";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface CursorPosition {
  line: number;
  column: number;
  selection?: { startLine: number; startCol: number; endLine: number; endCol: number };
}

export interface PresenceMetadata {
  color: string;
  name: string;
}

export interface PresenceState {
  userId: string;
  sessionId: string;
  cursor: CursorPosition;
  isTyping: boolean;
  lastActivity: Date;
  metadata: PresenceMetadata;
}

// ─── In-memory store ────────────────────────────────────────────────────────

// Cap presence map to prevent unbounded memory growth from many sessions
const MAX_PRESENCE_ENTRIES = 10_000;
// Key: `${sessionId}:${userId}`
const presenceMap = new Map<string, PresenceState>();
const typingTimers = new Map<string, ReturnType<typeof setTimeout>>();

function key(sessionId: string, userId: string): string {
  return `${sessionId}:${userId}`;
}

// ─── Core Functions ─────────────────────────────────────────────────────────

export function updatePresence(
  userId: string,
  sessionId: string,
  state: Partial<Pick<PresenceState, "cursor" | "isTyping" | "metadata">>,
): PresenceState {
  const k = key(sessionId, userId);
  const existing = presenceMap.get(k);
  // Enforce presence map cap
  if (!existing && presenceMap.size >= MAX_PRESENCE_ENTRIES) {
    throw new Error("Presence map full — too many active sessions");
  }
  const updated: PresenceState = {
    userId,
    sessionId,
    cursor: state.cursor ?? existing?.cursor ?? { line: 0, column: 0 },
    isTyping: state.isTyping ?? existing?.isTyping ?? false,
    lastActivity: new Date(),
    metadata: state.metadata ?? existing?.metadata ?? { color: "#000000", name: userId },
  };
  presenceMap.set(k, updated);
  // Evict oldest entries when map exceeds cap
  if (presenceMap.size > MAX_PRESENCE_ENTRIES) {
    const oldest = presenceMap.keys().next().value;
    if (oldest !== undefined) presenceMap.delete(oldest);
  }
  logger.debug({ userId, sessionId }, "Updated presence");
  return updated;
}

export function getPresence(sessionId: string): PresenceState[] {
  const result: PresenceState[] = [];
  for (const [, state] of presenceMap) {
    if (state.sessionId === sessionId) {
      result.push(state);
    }
  }
  return result;
}

export function getUserPresence(sessionId: string, userId: string): PresenceState | undefined {
  return presenceMap.get(key(sessionId, userId));
}

export function removePresence(userId: string, sessionId: string): boolean {
  const k = key(sessionId, userId);
  const timer = typingTimers.get(k);
  if (timer) {
    clearTimeout(timer);
    typingTimers.delete(k);
  }
  const deleted = presenceMap.delete(k);
  if (deleted) {
    logger.info({ userId, sessionId }, "Removed presence");
  }
  return deleted;
}

export function setTyping(userId: string, sessionId: string, isTyping: boolean): void {
  const k = key(sessionId, userId);
  const existing = presenceMap.get(k);
  if (!existing) {
    // Auto-create a minimal presence entry
    updatePresence(userId, sessionId, { isTyping });
  } else {
    existing.isTyping = isTyping;
    existing.lastActivity = new Date();
  }

  // Clear any existing auto-clear timer
  const existingTimer = typingTimers.get(k);
  if (existingTimer) {
    clearTimeout(existingTimer);
    typingTimers.delete(k);
  }

  // Auto-clear typing after 5 seconds
  if (isTyping) {
    const timer = setTimeout(() => {
      const state = presenceMap.get(k);
      if (state) {
        state.isTyping = false;
      }
      typingTimers.delete(k);
    }, 5000);
    typingTimers.set(k, timer);
  }
}

export function heartbeat(userId: string, sessionId: string): void {
  const k = key(sessionId, userId);
  const existing = presenceMap.get(k);
  if (existing) {
    existing.lastActivity = new Date();
  } else {
    updatePresence(userId, sessionId, {});
  }
}

export function cleanupStale(maxInactiveMs: number = 60_000): string[] {
  const now = Date.now();
  const removed: string[] = [];
  for (const [k, state] of presenceMap) {
    if (now - state.lastActivity.getTime() > maxInactiveMs) {
      const timer = typingTimers.get(k);
      if (timer) {
        clearTimeout(timer);
        typingTimers.delete(k);
      }
      presenceMap.delete(k);
      removed.push(k);
    }
  }
  if (removed.length > 0) {
    logger.info({ count: removed.length }, "Cleaned up stale presence entries");
  }
  return removed;
}

// ─── Reset (for tests) ─────────────────────────────────────────────────────

export function _reset(): void {
  for (const timer of typingTimers.values()) {
    clearTimeout(timer);
  }
  typingTimers.clear();
  presenceMap.clear();
}

// Auto-cleanup stale presence entries every 30 seconds
const PRESENCE_CLEANUP_INTERVAL_MS = 30_000;

setInterval(() => {
  cleanupStale(60_000); // Remove entries inactive for more than 1 minute
}, PRESENCE_CLEANUP_INTERVAL_MS).unref();
