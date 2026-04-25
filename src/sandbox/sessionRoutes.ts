/**
 * Sandbox Session Routes — persistent interactive container sessions
 *
 * Provides a "small computer" API: users get a persistent Linux environment
 * with shell access, file management, git, and package installation.
 *
 * Routes:
 *   POST   /sessions           — create a new sandbox session
 *   GET    /sessions           — list user's sessions
 *   GET    /sessions/:id       — get session details
 *   POST   /sessions/:id/exec  — execute a shell command
 *   POST   /sessions/:id/stop  — stop (pause) a session
 *   POST   /sessions/:id/resume — resume a stopped session
 *   DELETE /sessions/:id       — destroy a session
 *   GET    /sessions/:id/files — list files in a directory
 *   GET    /sessions/:id/files/read — read a file
 *   POST   /sessions/:id/files/write — write a file
 *   GET    /sessions/:id/system — get system info
 */

import type { FastifyPluginAsync } from "fastify";
import { fastifyRequireAuth } from "../middleware/fastifyAuth.js";
import { AppError } from "../middleware/errorHandler.js";
import {
  createSession,
  execCommand,
  listFiles,
  readFile,
  writeFile,
  getSystemInfo,
  stopSession,
  resumeSession,
  destroySession,
  listSessions,
  getSession,
} from "./sessionManager.js";

const sessionRoutes: FastifyPluginAsync = async (fastify) => {
  // ── Create Session ──
  fastify.post("/sessions", {
    preHandler: [fastifyRequireAuth],
    schema: {
      summary: "Create a new persistent sandbox session",
      tags: ["Sandbox"],
      body: {
        type: "object",
        properties: {
          gitName: { type: "string", description: "Git author name" },
          gitEmail: { type: "string", description: "Git author email" },
          gitPat: { type: "string", description: "Git personal access token for push/clone" },
          env: { type: "object", additionalProperties: { type: "string" }, description: "Extra environment variables" },
          metadata: { type: "object", additionalProperties: { type: "string" }, description: "Session metadata" },
        },
      },
      response: {
        201: {
          type: "object",
          properties: {
            id: { type: "string" },
            status: { type: "string" },
            createdAt: { type: "string" },
            gitConfigured: { type: "boolean" },
            message: { type: "string" },
          },
        },
      },
    },
  }, async (request, reply) => {
    const userId = String((request as unknown as { userId?: number }).userId);
    const body = request.body as {
      gitName?: string;
      gitEmail?: string;
      gitPat?: string;
      env?: Record<string, string>;
      metadata?: Record<string, string>;
    } | undefined;

    const session = await createSession(userId, {
      gitName: body?.gitName,
      gitEmail: body?.gitEmail,
      gitPat: body?.gitPat,
      env: body?.env,
      metadata: body?.metadata,
    });

    reply.code(201);
    return {
      id: session.id,
      status: session.status,
      createdAt: new Date(session.createdAt).toISOString(),
      gitConfigured: session.gitConfigured,
      message: "Sandbox session created. You have a full Linux environment with git, python, node, and shell access.",
    };
  });

  // ── List Sessions ──
  fastify.get("/sessions", {
    preHandler: [fastifyRequireAuth],
    schema: {
      summary: "List all sandbox sessions for the authenticated user",
      tags: ["Sandbox"],
    },
  }, async (request) => {
    const userId = String((request as unknown as { userId?: number }).userId);
    const userSessions = listSessions(userId);

    return {
      sessions: userSessions.map(s => ({
        id: s.id,
        status: s.status,
        createdAt: new Date(s.createdAt).toISOString(),
        lastActivity: new Date(s.lastActivityAt).toISOString(),
        gitConfigured: s.gitConfigured,
        metadata: s.metadata,
      })),
    };
  });

  // ── Get Session Details ──
  fastify.get("/sessions/:id", {
    preHandler: [fastifyRequireAuth],
    schema: {
      summary: "Get details of a specific sandbox session",
      tags: ["Sandbox"],
    },
  }, async (request) => {
    const { id } = request.params as { id: string };
    const userId = String((request as unknown as { userId?: number }).userId);
    const session = getSession(id);

    if (!session || session.userId !== userId) {
      throw new AppError(404, "Session not found", "SANDBOX_SESSION_NOT_FOUND");
    }

    return {
      id: session.id,
      status: session.status,
      createdAt: new Date(session.createdAt).toISOString(),
      lastActivity: new Date(session.lastActivityAt).toISOString(),
      gitConfigured: session.gitConfigured,
      metadata: session.metadata,
    };
  });

  // ── Execute Command ──
  fastify.post("/sessions/:id/exec", {
    preHandler: [fastifyRequireAuth],
    schema: {
      summary: "Execute a shell command in the sandbox",
      description: "Run any Linux command: git, python, node, npm, pip, ls, cat, grep, etc.",
      tags: ["Sandbox"],
      body: {
        type: "object",
        required: ["command"],
        properties: {
          command: { type: "string", description: "Shell command to execute", maxLength: 10000 },
          cwd: { type: "string", description: "Working directory (default: /workspace)" },
          timeoutMs: { type: "number", description: "Timeout in ms (max 120000)" },
          env: { type: "object", additionalProperties: { type: "string" } },
        },
      },
    },
  }, async (request) => {
    const { id } = request.params as { id: string };
    const userId = String((request as unknown as { userId?: number }).userId);
    const session = getSession(id);

    if (!session || session.userId !== userId) {
      throw new AppError(404, "Session not found", "SANDBOX_SESSION_NOT_FOUND");
    }

    const { command, cwd, timeoutMs, env } = request.body as {
      command: string;
      cwd?: string;
      timeoutMs?: number;
      env?: Record<string, string>;
    };

    if (!command || typeof command !== "string") {
      throw new AppError(400, "command is required", "SANDBOX_MISSING_FIELDS");
    }

    const result = await execCommand(id, command, { cwd, timeoutMs, env });

    return {
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode,
      durationMs: result.durationMs,
      cwd: result.cwd,
    };
  });

  // ── Stop Session ──
  fastify.post("/sessions/:id/stop", {
    preHandler: [fastifyRequireAuth],
    schema: {
      summary: "Stop (pause) a sandbox session. Can be resumed later.",
      tags: ["Sandbox"],
    },
  }, async (request) => {
    const { id } = request.params as { id: string };
    const userId = String((request as unknown as { userId?: number }).userId);
    const session = getSession(id);

    if (!session || session.userId !== userId) {
      throw new AppError(404, "Session not found", "SANDBOX_SESSION_NOT_FOUND");
    }

    await stopSession(id);
    return { id, status: "stopped" };
  });

  // ── Resume Session ──
  fastify.post("/sessions/:id/resume", {
    preHandler: [fastifyRequireAuth],
    schema: {
      summary: "Resume a stopped sandbox session",
      tags: ["Sandbox"],
    },
  }, async (request) => {
    const { id } = request.params as { id: string };
    const userId = String((request as unknown as { userId?: number }).userId);
    const session = getSession(id);

    if (!session || session.userId !== userId) {
      throw new AppError(404, "Session not found", "SANDBOX_SESSION_NOT_FOUND");
    }

    const resumed = await resumeSession(id);
    return { id: resumed.id, status: resumed.status };
  });

  // ── Destroy Session ──
  fastify.delete("/sessions/:id", {
    preHandler: [fastifyRequireAuth],
    schema: {
      summary: "Permanently destroy a sandbox session and its data",
      tags: ["Sandbox"],
    },
  }, async (request) => {
    const { id } = request.params as { id: string };
    const userId = String((request as unknown as { userId?: number }).userId);
    const session = getSession(id);

    if (!session || session.userId !== userId) {
      throw new AppError(404, "Session not found", "SANDBOX_SESSION_NOT_FOUND");
    }

    await destroySession(id);
    return { id, status: "destroyed" };
  });

  // ── List Files ──
  fastify.get("/sessions/:id/files", {
    preHandler: [fastifyRequireAuth],
    schema: {
      summary: "List files in a directory",
      tags: ["Sandbox"],
      querystring: {
        type: "object",
        properties: {
          path: { type: "string", default: "/workspace" },
        },
      },
    },
  }, async (request) => {
    const { id } = request.params as { id: string };
    const userId = String((request as unknown as { userId?: number }).userId);
    const session = getSession(id);

    if (!session || session.userId !== userId) {
      throw new AppError(404, "Session not found", "SANDBOX_SESSION_NOT_FOUND");
    }

    const { path: dirPath } = request.query as { path?: string };
    const files = await listFiles(id, dirPath ?? "/workspace");

    return { path: dirPath ?? "/workspace", files };
  });

  // ── Read File ──
  fastify.get("/sessions/:id/files/read", {
    preHandler: [fastifyRequireAuth],
    schema: {
      summary: "Read contents of a file",
      tags: ["Sandbox"],
      querystring: {
        type: "object",
        required: ["path"],
        properties: {
          path: { type: "string" },
        },
      },
    },
  }, async (request) => {
    const { id } = request.params as { id: string };
    const userId = String((request as unknown as { userId?: number }).userId);
    const session = getSession(id);

    if (!session || session.userId !== userId) {
      throw new AppError(404, "Session not found", "SANDBOX_SESSION_NOT_FOUND");
    }

    const { path: filePath } = request.query as { path: string };
    const content = await readFile(id, filePath);

    return { path: filePath, content };
  });

  // ── Write File ──
  fastify.post("/sessions/:id/files/write", {
    preHandler: [fastifyRequireAuth],
    schema: {
      summary: "Write content to a file",
      tags: ["Sandbox"],
      body: {
        type: "object",
        required: ["path", "content"],
        properties: {
          path: { type: "string" },
          content: { type: "string" },
        },
      },
    },
  }, async (request) => {
    const { id } = request.params as { id: string };
    const userId = String((request as unknown as { userId?: number }).userId);
    const session = getSession(id);

    if (!session || session.userId !== userId) {
      throw new AppError(404, "Session not found", "SANDBOX_SESSION_NOT_FOUND");
    }

    const { path: filePath, content } = request.body as { path: string; content: string };
    await writeFile(id, filePath, content);

    return { path: filePath, written: true };
  });

  // ── System Info ──
  fastify.get("/sessions/:id/system", {
    preHandler: [fastifyRequireAuth],
    schema: {
      summary: "Get system information (disk, memory, uptime)",
      tags: ["Sandbox"],
    },
  }, async (request) => {
    const { id } = request.params as { id: string };
    const userId = String((request as unknown as { userId?: number }).userId);
    const session = getSession(id);

    if (!session || session.userId !== userId) {
      throw new AppError(404, "Session not found", "SANDBOX_SESSION_NOT_FOUND");
    }

    return getSystemInfo(id);
  });
};

export default sessionRoutes;
