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

// ─── Build test app ─────────────────────────────────────────────────────────

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });

  function requireAuth(request: any, reply: any): boolean {
    const authHeader = request.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
      reply.code(401).send({ error: "Authentication required" });
      return false;
    }
    try {
      const token = authHeader.split(" ")[1];
      const decoded = jwt.verify(token, JWT_SECRET) as { userId: number; username: string };
      request.userId = decoded.userId;
      return true;
    } catch {
      reply.code(401).send({ error: "Invalid or expired token" });
      return false;
    }
  }

  function requireAdmin(request: any, reply: any): boolean {
    if (!requireAuth(request, reply)) return false;

    const user = fakeUsers.find((u) => u.id === request.userId);
    if (!user || user.role !== "admin") {
      reply.code(403).send({ error: "Admin access required" });
      return false;
    }
    return true;
  }

  // GET /api/metrics/usage — user usage metrics (requires auth)
  app.get("/api/metrics/usage", async (request: any, reply) => {
    if (!requireAuth(request, reply)) return;

    const { days = "30" } = request.query as { days?: string };
    const daysNum = parseInt(days, 10) || 30;

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - daysNum);

    return {
      period: {
        days: daysNum,
        from: cutoff.toISOString(),
        to: new Date().toISOString(),
      },
      summary: {
        totalChats: 42,
        totalTokens: 15000,
        avgDurationMs: 250,
      },
      daily: [
        { date: "2025-01-01", requests: 10, tokens: 5000 },
        { date: "2025-01-02", requests: 15, tokens: 6000 },
      ],
    };
  });

  // GET /api/metrics/system — system-wide metrics (requires admin)
  app.get("/api/metrics/system", async (request: any, reply) => {
    if (!requireAdmin(request, reply)) return;

    return {
      totalUsers: fakeUsers.length,
      totalConversations: 100,
      totalChats: 500,
      totalTokens: 250000,
      recentActivity: {
        chatsLast24h: 25,
      },
    };
  });

  // GET /api/metrics/conversation/:id — conversation metrics (requires auth)
  app.get("/api/metrics/conversation/:id", async (request: any, reply) => {
    if (!requireAuth(request, reply)) return;

    const { id } = request.params as { id: string };

    // Simulate not found for specific IDs
    if (id === "nonexistent") {
      reply.code(404);
      return { error: "Conversation not found" };
    }

    return {
      conversationId: id,
      title: "Test Conversation",
      totalChats: 10,
      totalTokens: 5000,
      avgDurationMs: 300,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  });

  await app.ready();
  return app;
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("Metrics Routes — /api/metrics", () => {
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

  // ── GET /api/metrics/system — admin required ───────────────────────────

  describe("GET /api/metrics/system", () => {
    it("should require admin role", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/metrics/system",
      });

      expect(res.statusCode).toBe(401);
    });

    it("should return 403 for non-admin user", async () => {
      const memberToken = generateToken(2, "member");

      const res = await app.inject({
        method: "GET",
        url: "/api/metrics/system",
        headers: { authorization: `Bearer ${memberToken}` },
      });

      expect(res.statusCode).toBe(403);
      expect(res.json().error).toMatch(/admin/i);
    });

    it("should return system metrics for admin", async () => {
      const adminToken = generateToken(1, "admin");

      const res = await app.inject({
        method: "GET",
        url: "/api/metrics/system",
        headers: { authorization: `Bearer ${adminToken}` },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toHaveProperty("totalUsers");
      expect(body).toHaveProperty("totalConversations");
      expect(body).toHaveProperty("totalChats");
      expect(body).toHaveProperty("totalTokens");
      expect(body).toHaveProperty("recentActivity");
      expect(body.recentActivity).toHaveProperty("chatsLast24h");
    });
  });

  // ── GET /api/metrics/usage — auth required ─────────────────────────────

  describe("GET /api/metrics/usage", () => {
    it("should require authentication", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/metrics/usage",
      });

      expect(res.statusCode).toBe(401);
    });

    it("should return usage metrics for authenticated user", async () => {
      const memberToken = generateToken(2, "member");

      const res = await app.inject({
        method: "GET",
        url: "/api/metrics/usage",
        headers: { authorization: `Bearer ${memberToken}` },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toHaveProperty("period");
      expect(body).toHaveProperty("summary");
      expect(body).toHaveProperty("daily");
      expect(body.summary).toHaveProperty("totalChats");
      expect(body.summary).toHaveProperty("totalTokens");
      expect(body.summary).toHaveProperty("avgDurationMs");
    });

    it("should accept custom days parameter", async () => {
      const memberToken = generateToken(2, "member");

      const res = await app.inject({
        method: "GET",
        url: "/api/metrics/usage?days=7",
        headers: { authorization: `Bearer ${memberToken}` },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().period.days).toBe(7);
    });

    it("should default to 30 days when days param is invalid", async () => {
      const memberToken = generateToken(2, "member");

      const res = await app.inject({
        method: "GET",
        url: "/api/metrics/usage?days=notanumber",
        headers: { authorization: `Bearer ${memberToken}` },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().period.days).toBe(30);
    });
  });

  // ── GET /api/metrics/conversation/:id ───────────────────────────────────

  describe("GET /api/metrics/conversation/:id", () => {
    it("should require authentication", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/metrics/conversation/conv-1",
      });

      expect(res.statusCode).toBe(401);
    });

    it("should return conversation metrics", async () => {
      const memberToken = generateToken(2, "member");

      const res = await app.inject({
        method: "GET",
        url: "/api/metrics/conversation/conv-1",
        headers: { authorization: `Bearer ${memberToken}` },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.conversationId).toBe("conv-1");
      expect(body).toHaveProperty("totalChats");
      expect(body).toHaveProperty("totalTokens");
      expect(body).toHaveProperty("avgDurationMs");
    });

    it("should return 404 for non-existent conversation", async () => {
      const memberToken = generateToken(2, "member");

      const res = await app.inject({
        method: "GET",
        url: "/api/metrics/conversation/nonexistent",
        headers: { authorization: `Bearer ${memberToken}` },
      });

      expect(res.statusCode).toBe(404);
    });
  });
});
