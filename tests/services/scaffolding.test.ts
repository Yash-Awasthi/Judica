import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock logger
vi.mock("../../src/lib/logger.js", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// Mock env
vi.mock("../../src/config/env.js", () => ({
  env: {
    DATABASE_URL: "postgresql://test:test@localhost:5432/test",
    JWT_SECRET: "test-jwt-secret-min-16-chars",
    MASTER_ENCRYPTION_KEY: "test-master-encryption-key-min-32-characters-long",
  },
}));

// Mock router
const mockRouteAndCollect = vi.fn();
vi.mock("../../src/router/index.js", () => ({
  routeAndCollect: (...args: unknown[]) => mockRouteAndCollect(...args),
}));

import {
  generateSchema,
  formatDrizzleSchema,
  generateFiles,
  scaffoldProject,
  inferDependencies,
  type ScaffoldSchema,
  type ScaffoldFile,
} from "../../src/services/scaffolding.service.js";

describe("scaffolding.service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("generateSchema", () => {
    it("should generate schema from description", async () => {
      mockRouteAndCollect.mockResolvedValue({
        text: JSON.stringify({
          tables: [
            {
              name: "users",
              columns: [
                { name: "id", type: "uuid", nullable: false, primaryKey: true },
                { name: "email", type: "text", nullable: false },
                { name: "createdAt", type: "timestamp", nullable: false },
              ],
            },
          ],
        }),
      });

      const schema = await generateSchema("A user management system");

      expect(schema.tables).toHaveLength(1);
      expect(schema.tables[0].name).toBe("users");
      expect(schema.tables[0].columns).toHaveLength(3);
    });

    it("should return empty schema on failure", async () => {
      mockRouteAndCollect.mockRejectedValue(new Error("LLM error"));

      const schema = await generateSchema("anything");
      expect(schema.tables).toHaveLength(0);
    });
  });

  describe("formatDrizzleSchema", () => {
    it("should format schema as Drizzle ORM code", () => {
      const schema: ScaffoldSchema = {
        tables: [
          {
            name: "posts",
            columns: [
              { name: "id", type: "uuid", nullable: false, primaryKey: true },
              { name: "title", type: "text", nullable: false },
              { name: "authorId", type: "uuid", nullable: false, references: { table: "users", column: "id" } },
              { name: "published", type: "boolean", nullable: false },
            ],
          },
        ],
      };

      const code = formatDrizzleSchema(schema);

      expect(code).toContain("pgTable");
      expect(code).toContain('"posts"');
      expect(code).toContain("uuid");
      expect(code).toContain("primaryKey()");
      expect(code).toContain("notNull()");
    });

    it("should handle empty schema", () => {
      const code = formatDrizzleSchema({ tables: [] });
      expect(code).toContain("import");
      expect(code).not.toContain("pgTable(");
    });

    it("should handle timestamp columns", () => {
      const schema: ScaffoldSchema = {
        tables: [
          {
            name: "events",
            columns: [
              { name: "id", type: "serial", nullable: false, primaryKey: true },
              { name: "occurredAt", type: "timestamp", nullable: false },
            ],
          },
        ],
      };

      const code = formatDrizzleSchema(schema);
      expect(code).toContain("timestamp");
      expect(code).toContain("occurredAt");
    });
  });

  describe("generateFiles", () => {
    it("should generate project files", async () => {
      mockRouteAndCollect.mockResolvedValue({
        text: JSON.stringify([
          { path: "src/routes/users.ts", content: "export default async function(app) {}", layer: "backend", description: "User API routes" },
          { path: "src/components/UserList.tsx", content: "export function UserList() { return <div /> }", layer: "frontend", description: "User list component" },
        ]),
      });

      const files = await generateFiles("User management app", { tables: [{ name: "users", columns: [] }] });

      expect(files).toHaveLength(2);
      expect(files[0].layer).toBe("backend");
      expect(files[1].layer).toBe("frontend");
    });

    it("should return empty array on failure", async () => {
      mockRouteAndCollect.mockRejectedValue(new Error("LLM error"));

      const files = await generateFiles("anything", { tables: [] });
      expect(files).toHaveLength(0);
    });
  });

  describe("inferDependencies", () => {
    it("should detect production dependencies", () => {
      const files: ScaffoldFile[] = [
        { path: "a.ts", content: 'import fastify from "fastify";\nimport { z } from "zod";', layer: "backend", description: "" },
        { path: "b.tsx", content: 'import React from "react";', layer: "frontend", description: "" },
      ];

      const deps = inferDependencies(files);

      expect(deps.production).toContain("fastify");
      expect(deps.production).toContain("zod");
      expect(deps.production).toContain("react");
      expect(deps.development).toContain("typescript");
    });

    it("should detect dev dependencies", () => {
      const files: ScaffoldFile[] = [
        { path: "test.ts", content: 'import { describe } from "vitest";', layer: "config", description: "" },
      ];

      const deps = inferDependencies(files);

      expect(deps.development).toContain("vitest");
      expect(deps.development).toContain("typescript");
    });

    it("should handle empty files", () => {
      const deps = inferDependencies([]);

      expect(deps.production).toHaveLength(0);
      expect(deps.development).toContain("typescript");
    });
  });

  describe("scaffoldProject", () => {
    it("should run full pipeline: schema → files → deps → instructions", async () => {
      // Call 1: generateSchema
      mockRouteAndCollect.mockResolvedValueOnce({
        text: JSON.stringify({
          tables: [
            { name: "tasks", columns: [{ name: "id", type: "uuid", nullable: false, primaryKey: true }, { name: "title", type: "text", nullable: false }] },
          ],
        }),
      });

      // Call 2: generateFiles
      mockRouteAndCollect.mockResolvedValueOnce({
        text: JSON.stringify([
          { path: "src/routes/tasks.ts", content: 'import fastify from "fastify";', layer: "backend", description: "Task API" },
        ]),
      });

      const result = await scaffoldProject("A task manager", "task-app");

      expect(result.projectName).toBe("task-app");
      expect(result.schema.tables).toHaveLength(1);
      // files = 1 from LLM + 1 auto-generated Drizzle schema
      expect(result.files.length).toBeGreaterThanOrEqual(2);
      expect(result.files.some((f) => f.path === "src/db/schema.ts")).toBe(true);
      expect(result.dependencies.production).toContain("fastify");
      expect(result.setupInstructions.length).toBeGreaterThan(0);
      expect(result.setupInstructions[0]).toContain("task-app");
    });

    it("should skip schema file when no tables", async () => {
      mockRouteAndCollect.mockResolvedValueOnce({ text: '{"tables": []}' });
      mockRouteAndCollect.mockResolvedValueOnce({ text: "[]" });

      const result = await scaffoldProject("A static site", "static-site");

      expect(result.schema.tables).toHaveLength(0);
      expect(result.files.some((f) => f.path === "src/db/schema.ts")).toBe(false);
    });
  });
});
