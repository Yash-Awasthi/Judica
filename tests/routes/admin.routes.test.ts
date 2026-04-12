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
  email: string;
  username: string;
  role: string;
  createdAt: Date;
}

const fakeUsers: FakeUser[] = [];
const fakeGroups: Array<{ id: string; name: string }> = [];
const fakeGroupMembers: Array<{ groupId: string; userId: number }> = [];

// ─── Build test app ─────────────────────────────────────────────────────────

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });

  // Middleware: require auth + role check
  function requireRole(role: string) {
    return (request: any, reply: any) => {
      const authHeader = request.headers.authorization;
      if (!authHeader?.startsWith("Bearer ")) {
        reply.code(401).send({ error: "Authentication required" });
        return false;
      }
      try {
        const token = authHeader.split(" ")[1];
        const decoded = jwt.verify(token, JWT_SECRET) as { userId: number; username: string };
        request.userId = decoded.userId;
        request.username = decoded.username;

        // Check role
        const user = fakeUsers.find((u) => u.id === decoded.userId);
        if (!user || user.role !== role) {
          reply.code(403).send({ error: `Role '${role}' required` });
          return false;
        }
        return true;
      } catch {
        reply.code(401).send({ error: "Invalid or expired token" });
        return false;
      }
    };
  }

  // GET /api/admin/users — list all users (admin only)
  app.get("/api/admin/users", async (request: any, reply) => {
    if (!requireRole("admin")(request, reply)) return;
    return {
      users: fakeUsers.map((u) => ({
        id: u.id,
        email: u.email,
        username: u.username,
        role: u.role,
        createdAt: u.createdAt,
      })),
    };
  });

  // PUT /api/admin/users/:id/role — change user role (admin only)
  app.put("/api/admin/users/:id/role", async (request: any, reply) => {
    if (!requireRole("admin")(request, reply)) return;

    const { role } = request.body as any;
    const validRoles = ["admin", "member", "viewer"];
    if (!validRoles.includes(role)) {
      reply.code(400);
      return { error: `Role must be: ${validRoles.join(", ")}` };
    }

    const { id } = request.params as { id: string };
    const user = fakeUsers.find((u) => u.id === parseInt(id));
    if (!user) {
      reply.code(404);
      return { error: "User not found" };
    }

    user.role = role;
    return { id: user.id, email: user.email, role: user.role };
  });

  // GET /api/admin/stats — system stats (admin only)
  app.get("/api/admin/stats", async (request: any, reply) => {
    if (!requireRole("admin")(request, reply)) return;
    return {
      totalUsers: fakeUsers.length,
      totalConversations: 42,
      totalChats: 100,
    };
  });

  // POST /api/admin/groups — create group (admin only)
  app.post("/api/admin/groups", async (request: any, reply) => {
    if (!requireRole("admin")(request, reply)) return;

    const { name } = request.body as any;
    if (!name) {
      reply.code(400);
      return { error: "Name required" };
    }

    const group = { id: `grp-${Date.now()}`, name };
    fakeGroups.push(group);
    reply.code(201);
    return group;
  });

  // GET /api/admin/groups — list groups (admin only)
  app.get("/api/admin/groups", async (request: any, reply) => {
    if (!requireRole("admin")(request, reply)) return;

    const groups = fakeGroups.map((g) => ({
      ...g,
      members: fakeGroupMembers
        .filter((m) => m.groupId === g.id)
        .map((m) => {
          const user = fakeUsers.find((u) => u.id === m.userId);
          return { user: { id: user?.id, email: user?.email, username: user?.username } };
        }),
    }));

    return { groups };
  });

  await app.ready();
  return app;
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("Admin Routes — /api/admin", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    fakeUsers.length = 0;
    fakeGroups.length = 0;
    fakeGroupMembers.length = 0;

    // Seed users
    fakeUsers.push(
      { id: 1, email: "admin@test.com", username: "admin", role: "admin", createdAt: new Date() },
      { id: 2, email: "member@test.com", username: "member", role: "member", createdAt: new Date() },
      { id: 3, email: "viewer@test.com", username: "viewer", role: "viewer", createdAt: new Date() },
    );
  });

  // ── Auth / Role Enforcement ─────────────────────────────────────────────

  describe("Role enforcement", () => {
    it("should return 401 when no token is provided", async () => {
      const res = await app.inject({ method: "GET", url: "/api/admin/users" });
      expect(res.statusCode).toBe(401);
    });

    it("should return 403 when member role accesses admin endpoint", async () => {
      const memberToken = generateToken(2, "member");

      const res = await app.inject({
        method: "GET",
        url: "/api/admin/users",
        headers: { authorization: `Bearer ${memberToken}` },
      });

      expect(res.statusCode).toBe(403);
      expect(res.json().error).toMatch(/role/i);
    });

    it("should return 403 when viewer role accesses admin endpoint", async () => {
      const viewerToken = generateToken(3, "viewer");

      const res = await app.inject({
        method: "GET",
        url: "/api/admin/stats",
        headers: { authorization: `Bearer ${viewerToken}` },
      });

      expect(res.statusCode).toBe(403);
    });

    it("should allow admin to access admin endpoints", async () => {
      const adminToken = generateToken(1, "admin");

      const res = await app.inject({
        method: "GET",
        url: "/api/admin/users",
        headers: { authorization: `Bearer ${adminToken}` },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.users).toHaveLength(3);
    });
  });

  // ── GET /api/admin/users ────────────────────────────────────────────────

  describe("GET /api/admin/users", () => {
    it("should return all users with profile info", async () => {
      const adminToken = generateToken(1, "admin");

      const res = await app.inject({
        method: "GET",
        url: "/api/admin/users",
        headers: { authorization: `Bearer ${adminToken}` },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.users).toHaveLength(3);
      expect(body.users[0]).toHaveProperty("id");
      expect(body.users[0]).toHaveProperty("email");
      expect(body.users[0]).toHaveProperty("username");
      expect(body.users[0]).toHaveProperty("role");
      expect(body.users[0]).toHaveProperty("createdAt");
    });
  });

  // ── PUT /api/admin/users/:id/role ───────────────────────────────────────

  describe("PUT /api/admin/users/:id/role", () => {
    it("should change user role when admin", async () => {
      const adminToken = generateToken(1, "admin");

      const res = await app.inject({
        method: "PUT",
        url: "/api/admin/users/2/role",
        headers: { authorization: `Bearer ${adminToken}` },
        payload: { role: "admin" },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().role).toBe("admin");
    });

    it("should return 400 for invalid role", async () => {
      const adminToken = generateToken(1, "admin");

      const res = await app.inject({
        method: "PUT",
        url: "/api/admin/users/2/role",
        headers: { authorization: `Bearer ${adminToken}` },
        payload: { role: "superadmin" },
      });

      expect(res.statusCode).toBe(400);
    });

    it("should return 403 when member tries to change role", async () => {
      const memberToken = generateToken(2, "member");

      const res = await app.inject({
        method: "PUT",
        url: "/api/admin/users/3/role",
        headers: { authorization: `Bearer ${memberToken}` },
        payload: { role: "admin" },
      });

      expect(res.statusCode).toBe(403);
    });
  });

  // ── GET /api/admin/stats ────────────────────────────────────────────────

  describe("GET /api/admin/stats", () => {
    it("should return system stats for admin", async () => {
      const adminToken = generateToken(1, "admin");

      const res = await app.inject({
        method: "GET",
        url: "/api/admin/stats",
        headers: { authorization: `Bearer ${adminToken}` },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toHaveProperty("totalUsers");
      expect(body).toHaveProperty("totalConversations");
      expect(body).toHaveProperty("totalChats");
    });
  });

  // ── POST /api/admin/groups ──────────────────────────────────────────────

  describe("POST /api/admin/groups", () => {
    it("should create a group as admin", async () => {
      const adminToken = generateToken(1, "admin");

      const res = await app.inject({
        method: "POST",
        url: "/api/admin/groups",
        headers: { authorization: `Bearer ${adminToken}` },
        payload: { name: "Engineering" },
      });

      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.name).toBe("Engineering");
      expect(body).toHaveProperty("id");
    });

    it("should return 400 when name is missing", async () => {
      const adminToken = generateToken(1, "admin");

      const res = await app.inject({
        method: "POST",
        url: "/api/admin/groups",
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {},
      });

      expect(res.statusCode).toBe(400);
    });
  });
});
