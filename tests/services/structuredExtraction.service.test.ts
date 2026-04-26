import { describe, it, expect, vi, beforeEach } from "vitest";

/* ── Hoisted mocks (must be declared before vi.mock factories) ────── */

const {
  mockDb,
  mockRouteAndCollect,
  mockFetch,
} = vi.hoisted(() => ({
  mockDb: {} as Record<string, any>,
  mockRouteAndCollect: vi.fn(),
  mockFetch: vi.fn(),
}));

/* ── Mock setup ────────────────────────────────────────────────────── */

function chainable(overrides: Record<string, any> = {}): any {
  const chain: any = {};
  const methods = [
    "select", "from", "where", "limit", "orderBy",
    "update", "set", "insert", "values", "returning",
    "delete",
  ];
  for (const m of methods) {
    chain[m] = overrides[m] ?? vi.fn(() => chain);
  }
  return chain;
}

vi.mock("../../src/lib/drizzle.js", () => ({
  get db() { return mockDb; },
}));

vi.mock("../../src/db/schema/structuredExtraction.js", () => ({
  extractionSchemas: {
    id: "extractionSchemas.id",
    userId: "extractionSchemas.userId",
    name: "extractionSchemas.name",
    description: "extractionSchemas.description",
    schema: "extractionSchemas.schema",
    outputFormat: "extractionSchemas.outputFormat",
    isPublic: "extractionSchemas.isPublic",
    version: "extractionSchemas.version",
    createdAt: "extractionSchemas.createdAt",
    updatedAt: "extractionSchemas.updatedAt",
  },
  extractionJobs: {
    id: "extractionJobs.id",
    schemaId: "extractionJobs.schemaId",
    userId: "extractionJobs.userId",
    url: "extractionJobs.url",
    status: "extractionJobs.status",
    result: "extractionJobs.result",
    extractedRows: "extractionJobs.extractedRows",
    pagesProcessed: "extractionJobs.pagesProcessed",
    executionTimeMs: "extractionJobs.executionTimeMs",
    errorMessage: "extractionJobs.errorMessage",
    authConfig: "extractionJobs.authConfig",
    paginationConfig: "extractionJobs.paginationConfig",
    createdAt: "extractionJobs.createdAt",
  },
  extractionTemplates: {
    id: "extractionTemplates.id",
    name: "extractionTemplates.name",
    description: "extractionTemplates.description",
    category: "extractionTemplates.category",
    schema: "extractionTemplates.schema",
    sampleUrls: "extractionTemplates.sampleUrls",
    createdAt: "extractionTemplates.createdAt",
  },
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((...args: any[]) => args),
  and: vi.fn((...args: any[]) => args),
  desc: vi.fn((col: any) => col),
}));

vi.mock("../../src/lib/logger.js", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../../src/lib/ssrf.js", () => ({
  validateSafeUrl: vi.fn(),
}));

vi.mock("../../src/lib/stealthBrowser.js", () => ({
  buildStealthHeaders: vi.fn(() => ({ "User-Agent": "test" })),
}));

vi.mock("../../src/router/smartRouter.js", () => ({
  routeAndCollect: mockRouteAndCollect,
}));

// Mock global fetch
vi.stubGlobal("fetch", mockFetch);

import {
  createSchema,
  getSchemas,
  getSchemaById,
  updateSchema,
  deleteSchema,
  getExtractionJobs,
  getExtractionJobById,
  cancelExtraction,
  getExtractionTemplates,
  exportResult,
} from "../../src/services/structuredExtraction.service.js";

/* ── Tests ─────────────────────────────────────────────────────────── */

beforeEach(() => {
  vi.clearAllMocks();
});

describe("structuredExtraction.service", () => {

  // ── createSchema ────────────────────────────────────────────────

  describe("createSchema", () => {
    it("should insert a schema and return it", async () => {
      const schema = {
        id: 1,
        userId: 42,
        name: "Products",
        description: "Extract products",
        schema: { fields: [{ name: "title", type: "string", required: true }] },
        outputFormat: "json",
        isPublic: false,
        version: 1,
      };

      const chain = chainable({
        returning: vi.fn(() => [schema]),
      });
      mockDb.insert = vi.fn(() => chain);

      const result = await createSchema(42, {
        name: "Products",
        description: "Extract products",
        schema: { fields: [{ name: "title", type: "string", required: true }] },
      });

      expect(result).toEqual(schema);
      expect(mockDb.insert).toHaveBeenCalled();
    });
  });

  // ── getSchemas ──────────────────────────────────────────────────

  describe("getSchemas", () => {
    it("should return schemas for user", async () => {
      const schemas = [
        { id: 1, userId: 42, name: "Products" },
        { id: 2, userId: 42, name: "Jobs" },
      ];

      const chain = chainable({
        orderBy: vi.fn(() => schemas),
      });
      mockDb.select = vi.fn(() => chain);

      const result = await getSchemas(42);
      expect(result).toEqual(schemas);
    });
  });

  // ── getSchemaById ───────────────────────────────────────────────

  describe("getSchemaById", () => {
    it("should return schema when found", async () => {
      const schema = { id: 1, userId: 42, name: "Products" };
      const chain = chainable({
        limit: vi.fn(() => [schema]),
      });
      mockDb.select = vi.fn(() => chain);

      const result = await getSchemaById(1, 42);
      expect(result).toEqual(schema);
    });

    it("should return null when not found", async () => {
      const chain = chainable({
        limit: vi.fn(() => []),
      });
      mockDb.select = vi.fn(() => chain);

      const result = await getSchemaById(999, 42);
      expect(result).toBeNull();
    });
  });

  // ── updateSchema ────────────────────────────────────────────────

  describe("updateSchema", () => {
    it("should update and return schema", async () => {
      const updated = { id: 1, userId: 42, name: "Updated Products" };

      // Mock getSchemaById for version lookup
      const selectChain = chainable({
        limit: vi.fn(() => [{ id: 1, userId: 42, version: 1 }]),
      });
      mockDb.select = vi.fn(() => selectChain);

      const updateChain = chainable({
        returning: vi.fn(() => [updated]),
      });
      mockDb.update = vi.fn(() => updateChain);

      const result = await updateSchema(1, 42, { name: "Updated Products" });
      expect(result).toEqual(updated);
    });

    it("should return null when schema not found", async () => {
      const updateChain = chainable({
        returning: vi.fn(() => []),
      });
      mockDb.update = vi.fn(() => updateChain);

      const result = await updateSchema(999, 42, { name: "Nothing" });
      expect(result).toBeNull();
    });
  });

  // ── deleteSchema ────────────────────────────────────────────────

  describe("deleteSchema", () => {
    it("should delete schema and associated jobs", async () => {
      const selectChain = chainable({
        where: vi.fn(() => []),
      });
      mockDb.select = vi.fn(() => selectChain);

      const deleteChain = chainable({
        returning: vi.fn(() => [{ id: 1 }]),
      });
      mockDb.delete = vi.fn(() => deleteChain);

      const result = await deleteSchema(1, 42);
      expect(result).toEqual({ id: 1 });
    });
  });

  // ── getExtractionJobs ───────────────────────────────────────────

  describe("getExtractionJobs", () => {
    it("should return jobs for user", async () => {
      const jobs = [{ id: 1, userId: 42, status: "completed" }];
      const chain = chainable({
        orderBy: vi.fn(() => jobs),
      });
      mockDb.select = vi.fn(() => chain);

      const result = await getExtractionJobs(42);
      expect(result).toEqual(jobs);
    });

    it("should filter by schemaId when provided", async () => {
      const jobs = [{ id: 1, userId: 42, schemaId: 5 }];
      const chain = chainable({
        orderBy: vi.fn(() => jobs),
      });
      mockDb.select = vi.fn(() => chain);

      const result = await getExtractionJobs(42, 5);
      expect(result).toEqual(jobs);
    });
  });

  // ── getExtractionJobById ────────────────────────────────────────

  describe("getExtractionJobById", () => {
    it("should return job when found", async () => {
      const job = { id: 1, userId: 42, status: "completed" };
      const chain = chainable({
        limit: vi.fn(() => [job]),
      });
      mockDb.select = vi.fn(() => chain);

      const result = await getExtractionJobById(1, 42);
      expect(result).toEqual(job);
    });

    it("should return null when not found", async () => {
      const chain = chainable({
        limit: vi.fn(() => []),
      });
      mockDb.select = vi.fn(() => chain);

      const result = await getExtractionJobById(999, 42);
      expect(result).toBeNull();
    });
  });

  // ── cancelExtraction ────────────────────────────────────────────

  describe("cancelExtraction", () => {
    it("should cancel pending job", async () => {
      const job = { id: 1, userId: 42, status: "pending" };
      const selectChain = chainable({ limit: vi.fn(() => [job]) });
      mockDb.select = vi.fn(() => selectChain);

      const cancelled = { ...job, status: "failed", errorMessage: "Cancelled by user" };
      const updateChain = chainable({ returning: vi.fn(() => [cancelled]) });
      mockDb.update = vi.fn(() => updateChain);

      const result = await cancelExtraction(1, 42);
      expect(result?.status).toBe("failed");
      expect(result?.errorMessage).toBe("Cancelled by user");
    });

    it("should throw for completed job", async () => {
      const job = { id: 1, userId: 42, status: "completed" };
      const selectChain = chainable({ limit: vi.fn(() => [job]) });
      mockDb.select = vi.fn(() => selectChain);

      await expect(cancelExtraction(1, 42)).rejects.toThrow("Can only cancel pending or running jobs");
    });

    it("should return null when job not found", async () => {
      const selectChain = chainable({ limit: vi.fn(() => []) });
      mockDb.select = vi.fn(() => selectChain);

      const result = await cancelExtraction(999, 42);
      expect(result).toBeNull();
    });
  });

  // ── getExtractionTemplates ──────────────────────────────────────

  describe("getExtractionTemplates", () => {
    it("should return built-in templates when DB is empty", async () => {
      const chain = chainable({
        orderBy: vi.fn(() => []),
      });
      mockDb.select = vi.fn(() => chain);

      const result = await getExtractionTemplates();
      expect(result.length).toBeGreaterThan(0);
      expect(result[0]).toHaveProperty("name");
      expect(result[0]).toHaveProperty("category");
    });

    it("should return DB templates when available", async () => {
      const dbTemplates = [{ id: 1, name: "Custom", category: "custom", schema: { fields: [] } }];
      const chain = chainable({
        orderBy: vi.fn(() => dbTemplates),
      });
      mockDb.select = vi.fn(() => chain);

      const result = await getExtractionTemplates();
      expect(result).toEqual(dbTemplates);
    });

    it("should filter by category", async () => {
      const chain = chainable({
        orderBy: vi.fn(() => []),
      });
      mockDb.select = vi.fn(() => chain);

      const result = await getExtractionTemplates("ecommerce");
      expect(result.every((t: any) => t.category === "ecommerce")).toBe(true);
    });
  });

  // ── exportResult ────────────────────────────────────────────────

  describe("exportResult", () => {
    it("should export completed job as JSON", async () => {
      const job = {
        id: 1,
        userId: 42,
        schemaId: 1,
        status: "completed",
        result: { rows: [{ title: "A", price: 10 }], totalRows: 1, confidence: 0.9, warnings: [] },
      };
      const jobChain = chainable({ limit: vi.fn(() => [job]) });

      const schema = { id: 1, userId: 42, schema: { fields: [{ name: "title", type: "string" }] } };
      const schemaChain = chainable({ limit: vi.fn(() => [schema]) });

      // First call for job, second for schema
      let callCount = 0;
      mockDb.select = vi.fn(() => {
        callCount++;
        return callCount === 1 ? jobChain : schemaChain;
      });

      const result = await exportResult(1, 42, "json");
      expect(result.contentType).toBe("application/json");
      expect(result.filename).toBe("extraction-1.json");
      expect(JSON.parse(result.data)).toHaveLength(1);
    });

    it("should export as CSV", async () => {
      const job = {
        id: 2,
        userId: 42,
        schemaId: 1,
        status: "completed",
        result: { rows: [{ title: "B", price: 20 }], totalRows: 1, confidence: 1, warnings: [] },
      };
      const jobChain = chainable({ limit: vi.fn(() => [job]) });

      const schema = { id: 1, userId: 42, schema: { fields: [{ name: "title", type: "string" }, { name: "price", type: "number" }] } };
      const schemaChain = chainable({ limit: vi.fn(() => [schema]) });

      let callCount = 0;
      mockDb.select = vi.fn(() => {
        callCount++;
        return callCount === 1 ? jobChain : schemaChain;
      });

      const result = await exportResult(2, 42, "csv");
      expect(result.contentType).toBe("text/csv");
      expect(result.data).toContain("title");
      expect(result.data).toContain("B");
    });

    it("should throw for non-completed job", async () => {
      const job = { id: 3, userId: 42, status: "running", result: null };
      const chain = chainable({ limit: vi.fn(() => [job]) });
      mockDb.select = vi.fn(() => chain);

      await expect(exportResult(3, 42)).rejects.toThrow("no results to export");
    });

    it("should throw for non-existent job", async () => {
      const chain = chainable({ limit: vi.fn(() => []) });
      mockDb.select = vi.fn(() => chain);

      await expect(exportResult(999, 42)).rejects.toThrow("not found");
    });
  });
});
