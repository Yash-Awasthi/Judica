/**
 * Integration test: Templates routes via fastify.inject()
 *
 * Tests the real route plugin mounted on a real Fastify instance,
 * verifying HTTP status codes, content-type, and response bodies
 * through the full request lifecycle.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildTestApp } from "../helpers/testApp.js";

let app: Awaited<ReturnType<typeof buildTestApp>>;

beforeAll(async () => {
  const { default: templatesPlugin } = await import("../../src/routes/templates.js");
  app = await buildTestApp([{ plugin: templatesPlugin, prefix: "/api/templates" }]);
});

afterAll(async () => {
  await app.close();
});

describe("GET /api/templates", () => {
  it("returns 200 with an array of templates", async () => {
    const res = await app.inject({ method: "GET", url: "/api/templates" });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThan(0);
  });

  it("each template has required fields (id, name, description)", async () => {
    const res = await app.inject({ method: "GET", url: "/api/templates" });
    const body = res.json();

    for (const t of body) {
      expect(t).toHaveProperty("id");
      expect(t).toHaveProperty("name");
      expect(t).toHaveProperty("description");
    }
  });

  it("returns application/json content-type", async () => {
    const res = await app.inject({ method: "GET", url: "/api/templates" });
    expect(res.headers["content-type"]).toMatch(/application\/json/);
  });
});

describe("GET /api/templates/:id", () => {
  it("returns a specific template by id", async () => {
    // First get the list to find a valid id
    const listRes = await app.inject({ method: "GET", url: "/api/templates" });
    const templates = listRes.json();
    const firstId = templates[0].id;

    const res = await app.inject({ method: "GET", url: `/api/templates/${firstId}` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.id).toBe(firstId);
    expect(body.name).toBeDefined();
  });

  it("returns 404 for nonexistent template id", async () => {
    const res = await app.inject({ method: "GET", url: "/api/templates/does-not-exist-xyz" });
    expect(res.statusCode).toBe(404);
    const body = res.json();
    expect(body.error).toBe("Template not found");
  });

  it("returns 404 for empty-string-like ids", async () => {
    const res = await app.inject({ method: "GET", url: "/api/templates/undefined" });
    expect(res.statusCode).toBe(404);
  });
});

describe("unsupported methods", () => {
  it("returns 404 for POST /api/templates", async () => {
    const res = await app.inject({ method: "POST", url: "/api/templates", payload: {} });
    expect(res.statusCode).toBe(404);
  });
});
