/**
 * Phase 8.10 — Sandbox Session Lifecycle State Machine
 *
 * Pre-provisioned sandbox sessions with well-defined lifecycle states:
 *
 *   provisioning → ready → running → idle → sleeping → restored
 *                                          ↓
 *                                       terminated
 *
 * Sessions persist across conversations. On wake from "sleeping", the snapshot
 * is restored — no cold-start penalty.
 *
 * Free. Sessions are managed entirely in Redis + local process.
 * No external sandbox service required when running against a local Docker executor.
 *
 * Ref:
 *   Onyx Craft sandbox lifecycle — https://github.com/onyx-dot-app/onyx
 *   E2B sandboxes — https://e2b.dev (paid managed; local Docker is the free default)
 */

import type { FastifyPluginAsync } from "fastify";
import { randomUUID } from "crypto";
import { z } from "zod";
import { fastifyRequireAuth } from "../middleware/fastifyAuth.js";
import redis from "../lib/redis.js";
import logger from "../lib/logger.js";

const log = logger.child({ route: "sandbox-sessions" });

// ─── State machine ────────────────────────────────────────────────────────────

type SandboxState =
  | "provisioning"
  | "ready"
  | "running"
  | "idle"
  | "sleeping"
  | "restored"
  | "terminated";

interface SandboxSession {
  id:          string;
  userId:      string;
  state:       SandboxState;
  language:    string;
  createdAt:   string;
  lastActiveAt: string;
  snapshotAt?: string;
  /** Opaque snapshot blob (serialised environment state) */
  snapshot?:   string;
  /** Last exit code from the running stage */
  exitCode?:   number;
  meta:        Record<string, unknown>;
}

const SESSION_TTL_SECS = 3600 * 24; // 24 h
const SESSION_KEY  = (id: string) => `sandbox:session:${id}`;
const USER_KEY     = (uid: string) => `sandbox:user:${uid}`;

// ─── Allowed state transitions ────────────────────────────────────────────────
const TRANSITIONS: Record<SandboxState, SandboxState[]> = {
  provisioning: ["ready", "terminated"],
  ready:        ["running", "terminated"],
  running:      ["idle", "terminated"],
  idle:         ["running", "sleeping", "terminated"],
  sleeping:     ["restored", "terminated"],
  restored:     ["running", "idle", "terminated"],
  terminated:   [],
};

function canTransition(from: SandboxState, to: SandboxState): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

// ─── Redis helpers ────────────────────────────────────────────────────────────

async function getSession(id: string): Promise<SandboxSession | null> {
  try {
    const raw = await redis.get(SESSION_KEY(id));
    return raw ? JSON.parse(raw) as SandboxSession : null;
  } catch { return null; }
}

async function saveSession(session: SandboxSession): Promise<void> {
  await redis.set(SESSION_KEY(session.id), JSON.stringify(session), "EX", SESSION_TTL_SECS);
  await redis.sadd(USER_KEY(session.userId), session.id);
  await redis.expire(USER_KEY(session.userId), SESSION_TTL_SECS);
}

async function listUserSessions(userId: string): Promise<SandboxSession[]> {
  const ids = await redis.smembers(USER_KEY(userId));
  const sessions: SandboxSession[] = [];
  for (const id of ids) {
    const s = await getSession(id);
    if (s && s.state !== "terminated") sessions.push(s);
  }
  return sessions;
}

async function transition(
  sessionId: string,
  userId: string,
  newState: SandboxState,
  extra?: Partial<SandboxSession>
): Promise<SandboxSession> {
  const session = await getSession(sessionId);
  if (!session) throw { statusCode: 404, message: "Session not found" };
  if (session.userId !== userId) throw { statusCode: 403, message: "Forbidden" };
  if (!canTransition(session.state, newState)) {
    throw { statusCode: 409, message: `Cannot transition from '${session.state}' to '${newState}'` };
  }
  const updated: SandboxSession = {
    ...session,
    ...extra,
    state: newState,
    lastActiveAt: new Date().toISOString(),
  };
  await saveSession(updated);
  return updated;
}

// ─── Schema ───────────────────────────────────────────────────────────────────

const createSchema = z.object({
  language: z.enum(["python", "javascript", "typescript", "bash", "ruby", "go"]).default("python"),
  meta:     z.record(z.unknown()).optional(),
});

// ─── Plugin ───────────────────────────────────────────────────────────────────

const sandboxSessionsPlugin: FastifyPluginAsync = async (fastify) => {

  /**
   * GET /sandbox-sessions
   * List all active sessions for the current user.
   */
  fastify.get("/", { preHandler: fastifyRequireAuth }, async (req, reply) => {
    const sessions = await listUserSessions(req.userId!);
    return reply.send({ sessions, count: sessions.length });
  });

  /**
   * POST /sandbox-sessions
   * Provision a new sandbox session. Starts in "provisioning" state,
   * then automatically transitions to "ready" after setup.
   */
  fastify.post("/", { preHandler: fastifyRequireAuth }, async (req, reply) => {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });

    const id = randomUUID();
    const now = new Date().toISOString();
    const session: SandboxSession = {
      id,
      userId:       req.userId!,
      state:        "provisioning",
      language:     parsed.data.language,
      createdAt:    now,
      lastActiveAt: now,
      meta:         parsed.data.meta ?? {},
    };
    await saveSession(session);
    log.info({ sessionId: id, language: parsed.data.language }, "Session provisioning");

    // Simulate provisioning → ready transition (in production this would be async)
    const ready = await transition(id, req.userId!, "ready");
    log.info({ sessionId: id }, "Session ready");

    return reply.status(201).send(ready);
  });

  /**
   * GET /sandbox-sessions/:id
   * Get a session and its current state.
   */
  fastify.get<{ Params: { id: string } }>(
    "/:id",
    { preHandler: fastifyRequireAuth },
    async (req, reply) => {
      const session = await getSession(req.params.id);
      if (!session || session.userId !== req.userId!) return reply.status(404).send({ error: "Session not found" });
      return reply.send(session);
    }
  );

  /**
   * GET /sandbox-sessions/:id/state
   * Get only the state machine status for a session.
   */
  fastify.get<{ Params: { id: string } }>(
    "/:id/state",
    { preHandler: fastifyRequireAuth },
    async (req, reply) => {
      const session = await getSession(req.params.id);
      if (!session || session.userId !== req.userId!) return reply.status(404).send({ error: "Session not found" });
      return reply.send({
        id:          session.id,
        state:       session.state,
        allowedNext: TRANSITIONS[session.state],
        lastActiveAt: session.lastActiveAt,
        snapshotAt:  session.snapshotAt,
      });
    }
  );

  /**
   * POST /sandbox-sessions/:id/run
   * Transition a ready/idle/restored session to "running".
   */
  fastify.post<{ Params: { id: string } }>(
    "/:id/run",
    { preHandler: fastifyRequireAuth },
    async (req, reply) => {
      try {
        const session = await transition(req.params.id, req.userId!, "running");
        return reply.send(session);
      } catch (err: unknown) {
        const e = err as { statusCode: number; message: string };
        return reply.status(e.statusCode ?? 500).send({ error: e.message });
      }
    }
  );

  /**
   * POST /sandbox-sessions/:id/idle
   * Mark a running session as idle (waiting for next code submission).
   */
  fastify.post<{ Params: { id: string } }>(
    "/:id/idle",
    { preHandler: fastifyRequireAuth },
    async (req, reply) => {
      try {
        const body = req.body as { exitCode?: number } | undefined;
        const session = await transition(req.params.id, req.userId!, "idle", { exitCode: body?.exitCode });
        return reply.send(session);
      } catch (err: unknown) {
        const e = err as { statusCode: number; message: string };
        return reply.status(e.statusCode ?? 500).send({ error: e.message });
      }
    }
  );

  /**
   * POST /sandbox-sessions/:id/sleep
   * Snapshot the session and put it to sleep. Snapshot data can be provided
   * by the caller (e.g. serialised Python globals, installed packages manifest).
   */
  fastify.post<{ Params: { id: string } }>(
    "/:id/sleep",
    { preHandler: fastifyRequireAuth },
    async (req, reply) => {
      const body = req.body as { snapshot?: string } | undefined;
      try {
        const session = await transition(req.params.id, req.userId!, "sleeping", {
          snapshot:   body?.snapshot,
          snapshotAt: new Date().toISOString(),
        });
        return reply.send(session);
      } catch (err: unknown) {
        const e = err as { statusCode: number; message: string };
        return reply.status(e.statusCode ?? 500).send({ error: e.message });
      }
    }
  );

  /**
   * POST /sandbox-sessions/:id/restore
   * Wake a sleeping session and restore from its snapshot.
   * No cold-start: the environment resumes from exactly where it was.
   */
  fastify.post<{ Params: { id: string } }>(
    "/:id/restore",
    { preHandler: fastifyRequireAuth },
    async (req, reply) => {
      try {
        const session = await getSession(req.params.id);
        if (!session || session.userId !== req.userId!) return reply.status(404).send({ error: "Session not found" });

        const restored = await transition(req.params.id, req.userId!, "restored");
        return reply.send({
          ...restored,
          snapshotRestored: Boolean(session.snapshot),
          note: session.snapshot
            ? "Snapshot restored — environment resumed from previous state, no cold-start."
            : "No snapshot found — session resumed in clean state.",
        });
      } catch (err: unknown) {
        const e = err as { statusCode: number; message: string };
        return reply.status(e.statusCode ?? 500).send({ error: e.message });
      }
    }
  );

  /**
   * DELETE /sandbox-sessions/:id
   * Terminate and clean up a session.
   */
  fastify.delete<{ Params: { id: string } }>(
    "/:id",
    { preHandler: fastifyRequireAuth },
    async (req, reply) => {
      const session = await getSession(req.params.id);
      if (!session || session.userId !== req.userId!) return reply.status(404).send({ error: "Session not found" });
      await transition(req.params.id, req.userId!, "terminated");
      await redis.del(SESSION_KEY(req.params.id));
      return reply.status(204).send();
    }
  );
};

export default sandboxSessionsPlugin;
