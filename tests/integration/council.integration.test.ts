/**
 * Integration test: Council routes via fastify.inject()
 *
 * Tests public endpoints (archetypes, summons, templates) and
 * protected endpoints (config CRUD) through the real route plugin.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { buildTestApp, createAuthHeaders, signTestToken } from "../helpers/testApp.js";

vi.mock("../../src/lib/redis.js", () => ({
  default: {
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue("OK"),
    pipeline: vi.fn(() => ({
      get: vi.fn().mockReturnThis(),
      exec: vi.fn().mockResolvedValue([[null, null], [null, null]]),
    })),
  },
}));

function chainable(resolveValue: any = []): any {
  const chain: any = {};
  const methods = [
    "select", "from", "where", "limit", "orderBy", "update", "set",
    "insert", "values", "returning", "delete", "innerJoin",
  ];
  for (const m of methods) {
    chain[m] = vi.fn(() => chain);
  }
  chain.then = (resolve: any, reject?: any) => Promise.resolve(resolveValue).then(resolve, reject);
  return chain;
}

vi.mock("../../src/lib/drizzle.js", () => ({
  db: {
    select: vi.fn(() => chainable([{ config: { defaultRounds: 3 } }])),
    insert: vi.fn(() => chainable([{ config: { defaultRounds: 3 } }])),
    update: vi.fn(() => chainable([{ config: { defaultRounds: 3 } }])),
    delete: vi.fn(() => chainable([])),
  },
}));

vi.mock("../../src/db/schema/auth.js", () => ({
  revokedTokens: { token: "revokedTokens.token" },
  refreshTokens: {},
  councilConfigs: {
    id: "councilConfigs.id",
    userId: "councilConfigs.userId",
    config: "councilConfigs.config",
    updatedAt: "councilConfigs.updatedAt",
  },
}));

vi.mock("../../src/db/schema/users.js", () => ({
  users: { id: "users.id", role: "users.role" },
  dailyUsage: {},
  userSettings: {},
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((...args: any[]) => args),
  and: vi.fn((...args: any[]) => args),
  sql: Object.assign(vi.fn(), { raw: vi.fn() }),
}));

vi.mock("../../src/lib/logger.js", () => ({
  default: {
    info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), child: vi.fn().mockReturnThis(),
  },
}));

vi.mock("../../src/middleware/errorHandler.js", () => ({
  AppError: class AppError extends Error {
    statusCode: number;
    code: string;
    constructor(statusCode: number, message: string, code: string = "INTERNAL_ERROR") {
      super(message);
      this.statusCode = statusCode;
      this.code = code;
    }
  },
}));

describe("Council routes integration", () => {
  let app: Awaited<ReturnType<typeof buildTestApp>>;

  beforeAll(async () => {
    const { default: councilPlugin } = await import("../../src/routes/council.js");
    app = await buildTestApp([{ plugin: councilPlugin, prefix: "/api/council" }]);
  });

  afterAll(async () => {
    await app.close();
  });

  // --- Public endpoints ---

  describe("GET /api/council/archetypes", () => {
    it("returns 200 with archetypes array (no auth required)", async () => {
      const res = await app.inject({ method: "GET", url: "/api/council/archetypes" });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toHaveProperty("archetypes");
      expect(Array.isArray(body.archetypes)).toBe(true);
      expect(body.archetypes.length).toBeGreaterThan(0);
    });

    it("each archetype has required fields", async () => {
      const res = await app.inject({ method: "GET", url: "/api/council/archetypes" });
      const { archetypes } = res.json();
      for (const a of archetypes) {
        expect(a).toHaveProperty("id");
        expect(a).toHaveProperty("name");
        expect(a).toHaveProperty("thinkingStyle");
      }
    });
  });

  describe("GET /api/council/archetypes/:id", () => {
    it("returns a specific archetype by valid id", async () => {
      const listRes = await app.inject({ method: "GET", url: "/api/council/archetypes" });
      const firstId = listRes.json().archetypes[0].id;

      const res = await app.inject({ method: "GET", url: `/api/council/archetypes/${firstId}` });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toHaveProperty("archetype");
    });

    it("returns 404 for nonexistent archetype", async () => {
      const res = await app.inject({ method: "GET", url: "/api/council/archetypes/nonexistent-xyz" });
      expect(res.statusCode).toBe(404);
      expect(res.json().error).toBe("Archetype not found");
    });
  });

  describe("GET /api/council/summons", () => {
    it("returns summons array (no auth required)", async () => {
      const res = await app.inject({ method: "GET", url: "/api/council/summons" });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toHaveProperty("summons");
    });
  });

  describe("GET /api/council/templates", () => {
    it("returns templates array (no auth required)", async () => {
      const res = await app.inject({ method: "GET", url: "/api/council/templates" });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toHaveProperty("templates");
    });
  });

  // --- Protected endpoints ---

  describe("GET /api/council/config", () => {
    it("returns 401 without auth", async () => {
      const res = await app.inject({ method: "GET", url: "/api/council/config" });
      expect(res.statusCode).toBe(401);
    });

    it("returns config with valid auth", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/council/config",
        headers: createAuthHeaders(),
      });
      expect(res.statusCode).not.toBe(401);
    });
  });

  describe("PUT /api/council/config", () => {
    it("returns 401 without auth", async () => {
      const res = await app.inject({
        method: "PUT",
        url: "/api/council/config",
        payload: { defaultRounds: 3 },
      });
      expect(res.statusCode).toBe(401);
    });

    it("accepts valid config update with auth", async () => {
      const res = await app.inject({
        method: "PUT",
        url: "/api/council/config",
        headers: createAuthHeaders(),
        payload: { defaultRounds: 3 },
      });
      expect(res.statusCode).not.toBe(401);
    });
  });

  describe("DELETE /api/council/config", () => {
    it("returns 401 without auth", async () => {
      const res = await app.inject({ method: "DELETE", url: "/api/council/config" });
      expect(res.statusCode).toBe(401);
    });

    it("deletes config with valid auth", async () => {
      const headers = createAuthHeaders();
      const res = await app.inject({
        method: "DELETE",
        url: "/api/council/config",
        headers,
        payload: {},
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().message).toBe("Council config deleted");
    });
  });
});
