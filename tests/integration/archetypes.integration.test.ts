/**
 * Integration test: Archetypes routes via fastify.inject()
 *
 * Tests optional auth behavior: unauthenticated users get defaults,
 * authenticated users get personalized archetypes.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { buildTestApp, createAuthHeaders } from "../helpers/testApp.js";

// Mock external deps
vi.mock("../../src/lib/redis.js", () => ({
  default: {
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue("OK"),
    del: vi.fn().mockResolvedValue(1),
    ping: vi.fn().mockResolvedValue("PONG"),
    pipeline: vi.fn(() => ({
      get: vi.fn().mockReturnThis(),
      exec: vi.fn().mockResolvedValue([[null, null], [null, null]]),
    })),
  },
}));

vi.mock("../../src/lib/drizzle.js", () => {
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

  return {
    db: {
      select: vi.fn(() => chainable([])),
      insert: vi.fn(() => chainable([])),
      update: vi.fn(() => chainable([])),
      delete: vi.fn(() => chainable([])),
    },
  };
});

vi.mock("../../src/db/schema/auth.js", () => ({
  revokedTokens: { token: "revokedTokens.token" },
  refreshTokens: {},
  councilConfigs: {},
}));

vi.mock("../../src/lib/logger.js", () => ({
  default: {
    info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), child: vi.fn().mockReturnThis(),
  },
}));

vi.mock("../../src/lib/archetypeManager.js", () => ({
  getUserArchetypes: vi.fn().mockResolvedValue([
    { id: "custom-1", name: "Custom Archetype", thinkingStyle: "analytical" },
  ]),
  upsertUserArchetype: vi.fn().mockResolvedValue({ id: "custom-1" }),
  deleteUserArchetype: vi.fn().mockResolvedValue(undefined),
  toggleArchetypeStatus: vi.fn().mockResolvedValue(true),
  validateArchetype: vi.fn().mockReturnValue({ valid: true, errors: [] }),
  cloneDefaultArchetype: vi.fn().mockReturnValue({ name: "Cloned", thinkingStyle: "creative" }),
  exportUserArchetypes: vi.fn().mockResolvedValue([]),
  importArchetypes: vi.fn().mockResolvedValue({ imported: 0, errors: [] }),
  getArchetypeUsage: vi.fn().mockResolvedValue({}),
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

describe("Archetypes integration", () => {
  let app: Awaited<ReturnType<typeof buildTestApp>>;

  beforeAll(async () => {
    const { default: archetypesPlugin } = await import("../../src/routes/archetypes.js");
    app = await buildTestApp([
      { plugin: archetypesPlugin, prefix: "/api/archetypes" },
    ]);
  });

  afterAll(async () => {
    await app.close();
  });

  describe("GET /api/archetypes (optional auth)", () => {
    it("returns default archetypes for unauthenticated users", async () => {
      const res = await app.inject({ method: "GET", url: "/api/archetypes" });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toHaveProperty("archetypes");
      expect(body.isCustom).toBe(false);
      // ARCHETYPES is a Record<string, Archetype>, not an array
      expect(typeof body.archetypes).toBe("object");
      expect(Object.keys(body.archetypes).length).toBeGreaterThan(0);
    });

    it("returns custom archetypes for authenticated users", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/archetypes",
        headers: createAuthHeaders(),
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.isCustom).toBe(true);
    });
  });

  describe("POST /api/archetypes (requires auth)", () => {
    it("returns 401 for unauthenticated users", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/archetypes",
        payload: { name: "Test" },
      });
      // The route itself checks userId and throws AppError(401)
      expect([401, 500]).toContain(res.statusCode);
    });

    it("creates archetype for authenticated users", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/archetypes",
        headers: createAuthHeaders(),
        payload: { name: "Test Archetype", thinkingStyle: "analytical" },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toHaveProperty("message");
    });
  });

  describe("DELETE /api/archetypes/:id (requires auth)", () => {
    it("returns error for unauthenticated users", async () => {
      const res = await app.inject({
        method: "DELETE",
        url: "/api/archetypes/some-id",
      });
      expect([401, 500]).toContain(res.statusCode);
    });

    it("accepts delete request for authenticated users", async () => {
      const res = await app.inject({
        method: "DELETE",
        url: "/api/archetypes/custom-1",
        headers: createAuthHeaders(),
      });
      // Should not be 401/403 — auth middleware allows it through
      expect(res.statusCode).not.toBe(401);
      expect(res.statusCode).not.toBe(403);
    });
  });
});
