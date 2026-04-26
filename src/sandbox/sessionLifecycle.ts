/**
 * Phase 8.10 — Sandbox Session Lifecycle State Machine
 *
 * Architecture inspired by Onyx Craft sandbox session management.
 *
 * States:
 *   provisioning → ready → running → idle → sleeping → restored
 *
 * Transitions:
 *   provisioning  → ready       (container created and health-checked)
 *   provisioning  → error       (creation failed)
 *   ready         → running     (first exec command received)
 *   running       → idle        (no command for IDLE_TIMEOUT_MS)
 *   idle          → running     (new command received)
 *   idle          → sleeping    (idle for SLEEP_TIMEOUT_MS, snapshot taken)
 *   sleeping      → restored    (new command wakes session, snapshot restored)
 *   restored      → running     (wake complete)
 *   running/idle  → destroyed   (explicit destroy or max lifetime exceeded)
 *   sleeping      → destroyed   (explicit destroy or max sleep exceeded)
 *   error         → destroyed   (cleanup)
 *
 * Benefits:
 *   - No cold-start penalty on repeated sandbox use (pre-provisioned pool)
 *   - Sessions persist across conversations via snapshot/restore
 *   - Resource efficiency: sleeping sessions release container resources
 *   - Predictable state management for orchestration and debugging
 *
 * Pre-provisioning pool:
 *   A pool of POOL_SIZE containers is kept in `ready` state, so the first
 *   exec request gets a warm container immediately.
 *
 * Snapshot/restore:
 *   On sleep: docker export → gzip → store in S3/local (snapshotPath)
 *   On wake:  docker import → container create → restore /workspace
 */

import { EventEmitter } from "events";
import logger from "../lib/logger.js";

const log = logger.child({ service: "sandboxLifecycle" });

// ─── Configuration ────────────────────────────────────────────────────────────

const IDLE_TIMEOUT_MS   = parseInt(process.env.SANDBOX_IDLE_TIMEOUT_MS    ?? "300000",  10); // 5 min
const SLEEP_TIMEOUT_MS  = parseInt(process.env.SANDBOX_SLEEP_TIMEOUT_MS   ?? "1800000", 10); // 30 min
const MAX_LIFETIME_MS   = parseInt(process.env.SANDBOX_MAX_LIFETIME_MS    ?? "86400000",10); // 24 hr
const POOL_SIZE         = parseInt(process.env.SANDBOX_POOL_SIZE          ?? "3",        10);
const POOL_REPLENISH_MS = parseInt(process.env.SANDBOX_POOL_REPLENISH_MS  ?? "30000",   10); // 30s

// ─── Types ────────────────────────────────────────────────────────────────────

export type SessionState =
  | "provisioning"
  | "ready"
  | "running"
  | "idle"
  | "sleeping"
  | "restored"
  | "destroyed"
  | "error";

export interface SessionLifecycleEvent {
  sessionId: string;
  from: SessionState;
  to: SessionState;
  ts: number;
  reason?: string;
}

export interface ManagedSession {
  id: string;
  userId: string;
  containerId?: string;
  snapshotPath?: string;
  state: SessionState;
  createdAt: number;
  lastActivityAt: number;
  lastStateChangeAt: number;
  idleTimer?: ReturnType<typeof setTimeout>;
  sleepTimer?: ReturnType<typeof setTimeout>;
  lifetimeTimer?: ReturnType<typeof setTimeout>;
  /** Accumulated exec count — useful for billing and debugging */
  execCount: number;
  metadata: Record<string, string>;
}

// ─── Allowed Transitions ──────────────────────────────────────────────────────

const ALLOWED_TRANSITIONS: Record<SessionState, SessionState[]> = {
  provisioning: ["ready", "error"],
  ready:        ["running", "destroyed"],
  running:      ["idle", "destroyed"],
  idle:         ["running", "sleeping", "destroyed"],
  sleeping:     ["restored", "destroyed"],
  restored:     ["running"],
  destroyed:    [],
  error:        ["destroyed"],
};

// ─── State Machine ────────────────────────────────────────────────────────────

export class SandboxLifecycleManager extends EventEmitter {
  private sessions = new Map<string, ManagedSession>();
  private pool: string[] = []; // sessionIds of ready sessions in pool

  constructor() {
    super();
    // Start pool replenishment interval
    const replenishInterval = setInterval(() => this._replenishPool(), POOL_REPLENISH_MS);
    replenishInterval.unref();
  }

  // ─── State Transition ───────────────────────────────────────────────────────

  transition(
    sessionId: string,
    to: SessionState,
    reason?: string
  ): ManagedSession {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session not found: ${sessionId}`);

    const allowed = ALLOWED_TRANSITIONS[session.state];
    if (!allowed.includes(to)) {
      throw new Error(
        `Invalid transition ${session.state} → ${to} for session ${sessionId}. ` +
        `Allowed: ${allowed.join(", ")}`
      );
    }

    const event: SessionLifecycleEvent = {
      sessionId,
      from: session.state,
      to,
      ts: Date.now(),
      reason,
    };

    // Clear existing timers before transition
    clearTimeout(session.idleTimer);
    clearTimeout(session.sleepTimer);

    session.state = to;
    session.lastStateChangeAt = Date.now();

    log.info(event, "Sandbox session state transition");
    this.emit("transition", event);
    this.emit(`transition:${to}`, event);

    // Set new timers based on target state
    if (to === "running") {
      session.idleTimer = setTimeout(
        () => this._onIdle(sessionId),
        IDLE_TIMEOUT_MS
      );
    }

    if (to === "idle") {
      session.sleepTimer = setTimeout(
        () => this._onSleep(sessionId),
        SLEEP_TIMEOUT_MS
      );
    }

    return session;
  }

  // ─── Session Registration ───────────────────────────────────────────────────

  registerSession(
    id: string,
    userId: string,
    containerId?: string,
    metadata?: Record<string, string>
  ): ManagedSession {
    const now = Date.now();
    const session: ManagedSession = {
      id,
      userId,
      containerId,
      state: "provisioning",
      createdAt: now,
      lastActivityAt: now,
      lastStateChangeAt: now,
      execCount: 0,
      metadata: metadata ?? {},
    };

    session.lifetimeTimer = setTimeout(
      () => this.transition(id, "destroyed", "max lifetime exceeded"),
      MAX_LIFETIME_MS
    );
    session.lifetimeTimer.unref();

    this.sessions.set(id, session);
    log.info({ sessionId: id, userId }, "Sandbox session registered");
    return session;
  }

  // ─── Pool Management ────────────────────────────────────────────────────────

  /**
   * Get a session from the pool (pre-provisioned, in ready state).
   * Returns undefined if pool is empty (caller must provision a new session).
   */
  acquireFromPool(userId: string): ManagedSession | undefined {
    const sessionId = this.pool.shift();
    if (!sessionId) return undefined;

    const session = this.sessions.get(sessionId);
    if (!session || session.state !== "ready") return undefined;

    // Reassign to the requesting user
    session.userId = userId;
    this.transition(sessionId, "running", "acquired from pool");
    return session;
  }

  /**
   * Return a session to the pool (only if state is ready and userId is still pool owner).
   */
  addToPool(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session || session.state !== "ready") return;
    if (this.pool.length < POOL_SIZE) {
      this.pool.push(sessionId);
      log.debug({ sessionId, poolSize: this.pool.length }, "Session added to pool");
    }
  }

  poolSize(): number { return this.pool.length; }

  // ─── Activity Tracking ──────────────────────────────────────────────────────

  /**
   * Record activity (exec call) — resets the idle timer.
   */
  recordActivity(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    session.lastActivityAt = Date.now();
    session.execCount++;

    if (session.state === "idle" || session.state === "restored") {
      this.transition(sessionId, "running", "activity received");
    } else if (session.state === "sleeping") {
      this._wakeSession(sessionId);
    } else if (session.state === "running") {
      // Reset idle timer
      clearTimeout(session.idleTimer);
      session.idleTimer = setTimeout(
        () => this._onIdle(sessionId),
        IDLE_TIMEOUT_MS
      );
    }
  }

  // ─── Internal Lifecycle Hooks ───────────────────────────────────────────────

  private _onIdle(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session || session.state !== "running") return;
    this.transition(sessionId, "idle", "idle timeout");
  }

  private _onSleep(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session || session.state !== "idle") return;
    this.transition(sessionId, "sleeping", "sleep timeout");
    // Snapshot is taken by the external session manager when it receives the sleeping event
    log.info({ sessionId }, "Session sleeping — snapshot should be taken by session manager");
  }

  private _wakeSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session || session.state !== "sleeping") return;
    this.transition(sessionId, "restored", "wake on activity");
    this.transition(sessionId, "running", "restore complete");
  }

  private _replenishPool(): void {
    const deficit = POOL_SIZE - this.pool.length;
    if (deficit > 0) {
      this.emit("pool:replenish", { deficit });
    }
  }

  // ─── Getters ─────────────────────────────────────────────────────────────────

  getSession(id: string): ManagedSession | undefined {
    return this.sessions.get(id);
  }

  listSessions(userId?: string): ManagedSession[] {
    const all = [...this.sessions.values()];
    return userId ? all.filter(s => s.userId === userId) : all;
  }

  destroySession(id: string, reason?: string): void {
    const session = this.sessions.get(id);
    if (!session || session.state === "destroyed") return;
    clearTimeout(session.idleTimer);
    clearTimeout(session.sleepTimer);
    clearTimeout(session.lifetimeTimer);
    this.transition(id, "destroyed", reason ?? "explicit destroy");
    this.sessions.delete(id);
    // Remove from pool if present
    const idx = this.pool.indexOf(id);
    if (idx !== -1) this.pool.splice(idx, 1);
  }
}

// Singleton instance
export const sandboxLifecycle = new SandboxLifecycleManager();
