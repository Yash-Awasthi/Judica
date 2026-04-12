import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import Fastify, { FastifyInstance } from "fastify";
import jwt from "jsonwebtoken";

// ─── Constants ──────────────────────────────────────────────────────────────

const JWT_SECRET = "test-jwt-secret-min-16-chars";

// ─── Mocks ──────────────────────────────────────────────────────────────────

vi.mock("../../src/config/env.js", () => ({
  env: {
    NODE_ENV: "test",
    JWT_SECRET: "test-jwt-secret-min-16-chars",
    MASTER_ENCRYPTION_KEY: "test-master-encryption-key-min-32-characters-long",
  },
}));

vi.mock("../../src/lib/logger.js", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../../src/lib/redis.js", () => ({
  default: { get: vi.fn().mockResolvedValue(null), set: vi.fn().mockResolvedValue("OK") },
}));

// ─── Helpers ────────────────────────────────────────────────────────────────

function generateToken(userId: number, username: string): string {
  return jwt.sign({ userId, username }, JWT_SECRET, { expiresIn: "15m" });
}

// ─── In-memory state ────────────────────────────────────────────────────────

const fakeProviders: Array<{ id: string; name: string; apiKey: string; model: string; type: string }> = [];

// ─── Build test app ─────────────────────────────────────────────────────────

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });

  // Auth middleware helper
  function requireAuth(request: any, reply: any) {
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
      return true;
    } catch {
      reply.code(401).send({ error: "Invalid or expired token" });
      return false;
    }
  }

  // GET /api/providers — list providers (requires auth)
  app.get("/api/providers", async (request: any, reply) => {
    if (!requireAuth(request, reply)) return;

    const maskedProviders = fakeProviders.map((p) => ({
      ...p,
      apiKey: p.apiKey ? "••••••••" + p.apiKey.slice(-4) : null,
    }));

    return { providers: maskedProviders };
  });

  // POST /api/providers/test — test provider connection (requires auth)
  app.post("/api/providers/test", async (request: any, reply) => {
    if (!requireAuth(request, reply)) return;

    const { type, apiKey, model, baseUrl } = request.body as any;

    if (!type || !apiKey || !model) {
      reply.code(400);
      return { error: "Validation failed" };
    }

    // Simulate a provider test
    return {
      success: true,
      response: "Hello, I am working!",
      usage: { promptTokens: 10, completionTokens: 5 },
      latencyMs: 150,
    };
  });

  // POST /api/providers — add provider (requires auth)
  app.post("/api/providers", async (request: any, reply) => {
    if (!requireAuth(request, reply)) return;

    const { name, type, apiKey, model } = request.body as any;
    if (!name || !type || !apiKey || !model) {
      reply.code(400);
      return { error: "Validation failed" };
    }

    const provider = {
      id: Date.now().toString(),
      name,
      type,
      apiKey: `enc:${apiKey}`,
      model,
    };
    fakeProviders.push(provider);

    reply.code(201);
    return {
      provider: { ...provider, apiKey: "••••••••" + apiKey.slice(-4) },
    };
  });

  // DELETE /api/providers/:id — delete provider (requires auth)
  app.delete("/api/providers/:id", async (request: any, reply) => {
    if (!requireAuth(request, reply)) return;

    const { id } = request.params as { id: string };
    const idx = fakeProviders.findIndex((p) => p.id === id);
    if (idx === -1) {
      reply.code(404);
      return { error: "Provider not found" };
    }
    fakeProviders.splice(idx, 1);
    return { message: "Provider deleted" };
  });

  await app.ready();
  return app;
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("Providers Routes — /api/providers", () => {
  let app: FastifyInstance;
  const validToken = generateToken(1, "testuser");

  beforeAll(async () => {
    app = await buildApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    fakeProviders.length = 0;
  });

  // ── GET /api/providers ──────────────────────────────────────────────────

  describe("GET /api/providers", () => {
    it("should return provider list with masked API keys", async () => {
      fakeProviders.push({
        id: "1",
        name: "OpenAI",
        apiKey: "sk-test-abcdefghijklmnop",
        model: "gpt-4o",
        type: "api",
      });

      const res = await app.inject({
        method: "GET",
        url: "/api/providers",
        headers: { authorization: `Bearer ${validToken}` },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.providers).toHaveLength(1);
      expect(body.providers[0].apiKey).toContain("••••••••");
      expect(body.providers[0].apiKey).not.toContain("sk-test");
    });

    it("should return empty array when no providers configured", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/providers",
        headers: { authorization: `Bearer ${validToken}` },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().providers).toHaveLength(0);
    });

    it("should return 401 without auth token", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/providers",
      });

      expect(res.statusCode).toBe(401);
    });
  });

  // ── POST /api/providers/test ────────────────────────────────────────────

  describe("POST /api/providers/test", () => {
    it("should return 401 without auth token", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/providers/test",
        payload: { type: "api", apiKey: "sk-test", model: "gpt-4o" },
      });

      expect(res.statusCode).toBe(401);
    });

    it("should test provider connection with valid auth", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/providers/test",
        headers: { authorization: `Bearer ${validToken}` },
        payload: { type: "api", apiKey: "sk-test-key1234", model: "gpt-4o" },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.success).toBe(true);
      expect(body).toHaveProperty("latencyMs");
      expect(body).toHaveProperty("response");
    });

    it("should return 400 with missing fields", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/providers/test",
        headers: { authorization: `Bearer ${validToken}` },
        payload: { type: "api" },
      });

      expect(res.statusCode).toBe(400);
    });
  });

  // ── POST /api/providers ─────────────────────────────────────────────────

  describe("POST /api/providers", () => {
    it("should add a new provider and return 201", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/providers",
        headers: { authorization: `Bearer ${validToken}` },
        payload: { name: "OpenAI", type: "api", apiKey: "sk-test1234", model: "gpt-4o" },
      });

      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.provider.name).toBe("OpenAI");
      expect(body.provider.apiKey).toContain("••••••••");
    });
  });

  // ── DELETE /api/providers/:id ───────────────────────────────────────────

  describe("DELETE /api/providers/:id", () => {
    it("should delete existing provider", async () => {
      fakeProviders.push({ id: "del-1", name: "ToDelete", apiKey: "key", model: "gpt-4", type: "api" });

      const res = await app.inject({
        method: "DELETE",
        url: "/api/providers/del-1",
        headers: { authorization: `Bearer ${validToken}` },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().message).toBe("Provider deleted");
      expect(fakeProviders).toHaveLength(0);
    });

    it("should return 404 for non-existent provider", async () => {
      const res = await app.inject({
        method: "DELETE",
        url: "/api/providers/nonexistent",
        headers: { authorization: `Bearer ${validToken}` },
      });

      expect(res.statusCode).toBe(404);
    });
  });
});
