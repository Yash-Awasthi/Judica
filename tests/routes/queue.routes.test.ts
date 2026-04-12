import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import Fastify, { FastifyInstance } from "fastify";
import jwt from "jsonwebtoken";

// ─── Constants ──────────────────────────────────────────────────────────────

const JWT_SECRET = "test-jwt-secret-min-16-chars";

// ─── Mocks ──────────────────────────────────────────────────────────────────

vi.mock("../../src/config/env.js", () => ({
  env: { NODE_ENV: "test", JWT_SECRET: "test-jwt-secret-min-16-chars" },
}));

vi.mock("../../src/lib/logger.js", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// ─── Helpers ────────────────────────────────────────────────────────────────

function generateToken(userId: number, username: string): string {
  return jwt.sign({ userId, username }, JWT_SECRET, { expiresIn: "15m" });
}

// ─── In-memory state ────────────────────────────────────────────────────────

interface FakeUser {
  id: number;
  username: string;
  role: string;
}

const fakeUsers: FakeUser[] = [];

const fakeQueueStats = {
  ingestion: { active: 2, waiting: 5, completed: 100, failed: 3 },
  research: { active: 0, waiting: 1, completed: 50, failed: 0 },
  "repo-ingestion": { active: 1, waiting: 0, completed: 25, failed: 1 },
  compaction: { active: 0, waiting: 0, completed: 10, failed: 0 },
};

// ─── Build test app ─────────────────────────────────────────────────────────

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });

  function requireRole(...roles: string[]) {
    return (request: any, reply: any): boolean => {
      const authHeader = request.headers.authorization;
      if (!authHeader?.startsWith("Bearer ")) {
        reply.code(401).send({ error: "Not authenticated" });
        return false;
      }
      try {
        const token = authHeader.split(" ")[1];
        const decoded = jwt.verify(token, JWT_SECRET) as { userId: number; username: string };
        request.userId = decoded.userId;

        const user = fakeUsers.find((u) => u.id === decoded.userId);
        if (!user || !roles.includes(user.role)) {
          reply.code(403).send({ error: "Insufficient permissions" });
          return false;
        }
        return true;
      } catch {
        reply.code(401).send({ error: "Invalid or expired token" });
        return false;
      }
    };
  }

  // GET /api/queue/stats — queue stats (admin only)
  app.get("/api/queue/stats", async (request: any, reply) => {
    if (!requireRole("admin")(request, reply)) return;

    return { data: fakeQueueStats };
  });

  // GET /api/queue/jobs/:queueName/:jobId — job status (admin only)
  app.get("/api/queue/jobs/:queueName/:jobId", async (request: any, reply) => {
    if (!requireRole("admin")(request, reply)) return;

    const { queueName, jobId } = request.params as { queueName: string; jobId: string };
    const validQueues = ["ingestion", "research", "repo-ingestion", "compaction"];

    if (!validQueues.includes(queueName)) {
      reply.code(404);
      return { error: "Queue not found" };
    }

    // Simulate job lookup
    if (jobId === "nonexistent") {
      reply.code(404);
      return { error: "Job not found" };
    }

    return {
      data: {
        id: jobId,
        name: "test-job",
        state: "completed",
        data: {},
        progress: 100,
        attemptsMade: 1,
        timestamp: Date.now(),
        finishedOn: Date.now(),
        failedReason: null,
      },
    };
  });

  // DELETE /api/queue/jobs/:queueName/:jobId — cancel job (admin only)
  app.delete("/api/queue/jobs/:queueName/:jobId", async (request: any, reply) => {
    if (!requireRole("admin")(request, reply)) return;

    const { queueName, jobId } = request.params as { queueName: string; jobId: string };
    const validQueues = ["ingestion", "research", "repo-ingestion", "compaction"];

    if (!validQueues.includes(queueName)) {
      reply.code(404);
      return { error: "Queue not found" };
    }

    return { message: "Job cancelled", jobId, previousState: "waiting" };
  });

  await app.ready();
  return app;
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("Queue Routes — /api/queue", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    fakeUsers.length = 0;
    fakeUsers.push(
      { id: 1, username: "admin", role: "admin" },
      { id: 2, username: "member", role: "member" },
    );
  });

  // ── GET /api/queue/stats ────────────────────────────────────────────────

  describe("GET /api/queue/stats", () => {
    it("should require admin role", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/queue/stats",
      });

      expect(res.statusCode).toBe(401);
    });

    it("should return 403 for non-admin users", async () => {
      const memberToken = generateToken(2, "member");

      const res = await app.inject({
        method: "GET",
        url: "/api/queue/stats",
        headers: { authorization: `Bearer ${memberToken}` },
      });

      expect(res.statusCode).toBe(403);
      expect(res.json().error).toMatch(/insufficient/i);
    });

    it("should return queue stats for admin", async () => {
      const adminToken = generateToken(1, "admin");

      const res = await app.inject({
        method: "GET",
        url: "/api/queue/stats",
        headers: { authorization: `Bearer ${adminToken}` },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.data).toHaveProperty("ingestion");
      expect(body.data).toHaveProperty("research");
      expect(body.data).toHaveProperty("repo-ingestion");
      expect(body.data).toHaveProperty("compaction");
      expect(body.data.ingestion).toHaveProperty("active");
      expect(body.data.ingestion).toHaveProperty("waiting");
      expect(body.data.ingestion).toHaveProperty("completed");
      expect(body.data.ingestion).toHaveProperty("failed");
    });
  });

  // ── GET /api/queue/jobs/:queueName/:jobId ───────────────────────────────

  describe("GET /api/queue/jobs/:queueName/:jobId", () => {
    it("should return 401 without token", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/queue/jobs/ingestion/job-1",
      });

      expect(res.statusCode).toBe(401);
    });

    it("should return 403 for member role", async () => {
      const memberToken = generateToken(2, "member");

      const res = await app.inject({
        method: "GET",
        url: "/api/queue/jobs/ingestion/job-1",
        headers: { authorization: `Bearer ${memberToken}` },
      });

      expect(res.statusCode).toBe(403);
    });

    it("should return job status for admin", async () => {
      const adminToken = generateToken(1, "admin");

      const res = await app.inject({
        method: "GET",
        url: "/api/queue/jobs/ingestion/job-1",
        headers: { authorization: `Bearer ${adminToken}` },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.data).toHaveProperty("id");
      expect(body.data).toHaveProperty("state");
      expect(body.data).toHaveProperty("progress");
    });

    it("should return 404 for unknown queue", async () => {
      const adminToken = generateToken(1, "admin");

      const res = await app.inject({
        method: "GET",
        url: "/api/queue/jobs/unknown-queue/job-1",
        headers: { authorization: `Bearer ${adminToken}` },
      });

      expect(res.statusCode).toBe(404);
    });

    it("should return 404 for nonexistent job", async () => {
      const adminToken = generateToken(1, "admin");

      const res = await app.inject({
        method: "GET",
        url: "/api/queue/jobs/ingestion/nonexistent",
        headers: { authorization: `Bearer ${adminToken}` },
      });

      expect(res.statusCode).toBe(404);
    });
  });

  // ── DELETE /api/queue/jobs/:queueName/:jobId ────────────────────────────

  describe("DELETE /api/queue/jobs/:queueName/:jobId", () => {
    it("should cancel a job as admin", async () => {
      const adminToken = generateToken(1, "admin");

      const res = await app.inject({
        method: "DELETE",
        url: "/api/queue/jobs/ingestion/job-1",
        headers: { authorization: `Bearer ${adminToken}` },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().message).toBe("Job cancelled");
    });

    it("should return 403 for non-admin", async () => {
      const memberToken = generateToken(2, "member");

      const res = await app.inject({
        method: "DELETE",
        url: "/api/queue/jobs/ingestion/job-1",
        headers: { authorization: `Bearer ${memberToken}` },
      });

      expect(res.statusCode).toBe(403);
    });
  });
});
