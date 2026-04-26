import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";
import Fastify from "fastify";
import type { FastifyInstance } from "fastify";

/* ── Hoisted mocks ─────────────────────────────────────────────────── */

const {
  mockCreateSchema,
  mockGetSchemas,
  mockGetSchemaById,
  mockUpdateSchema,
  mockDeleteSchema,
  mockRunExtraction,
  mockGetExtractionJobs,
  mockGetExtractionJobById,
  mockCancelExtraction,
  mockGetExtractionTemplates,
  mockPreviewExtraction,
  mockExportResult,
} = vi.hoisted(() => ({
  mockCreateSchema: vi.fn(),
  mockGetSchemas: vi.fn(),
  mockGetSchemaById: vi.fn(),
  mockUpdateSchema: vi.fn(),
  mockDeleteSchema: vi.fn(),
  mockRunExtraction: vi.fn(),
  mockGetExtractionJobs: vi.fn(),
  mockGetExtractionJobById: vi.fn(),
  mockCancelExtraction: vi.fn(),
  mockGetExtractionTemplates: vi.fn(),
  mockPreviewExtraction: vi.fn(),
  mockExportResult: vi.fn(),
}));

const { mockInferSchemaFromUrl, mockValidateSafeUrl, mockBuildStealthHeaders, mockFetch } = vi.hoisted(() => ({
  mockInferSchemaFromUrl: vi.fn(),
  mockValidateSafeUrl: vi.fn(),
  mockBuildStealthHeaders: vi.fn(() => ({ "User-Agent": "test" })),
  mockFetch: vi.fn(),
}));

vi.mock("../../src/services/structuredExtraction.service.js", () => ({
  createSchema: mockCreateSchema,
  getSchemas: mockGetSchemas,
  getSchemaById: mockGetSchemaById,
  updateSchema: mockUpdateSchema,
  deleteSchema: mockDeleteSchema,
  runExtraction: mockRunExtraction,
  getExtractionJobs: mockGetExtractionJobs,
  getExtractionJobById: mockGetExtractionJobById,
  cancelExtraction: mockCancelExtraction,
  getExtractionTemplates: mockGetExtractionTemplates,
  previewExtraction: mockPreviewExtraction,
  exportResult: mockExportResult,
}));

vi.mock("../../src/lib/extractionEngine.js", () => ({
  inferSchemaFromUrl: mockInferSchemaFromUrl,
}));

vi.mock("../../src/lib/ssrf.js", () => ({
  validateSafeUrl: mockValidateSafeUrl,
}));

vi.mock("../../src/lib/stealthBrowser.js", () => ({
  buildStealthHeaders: mockBuildStealthHeaders,
}));

vi.stubGlobal("fetch", mockFetch);

import { structuredExtractionPlugin } from "../../src/routes/structured-extraction.js";

/* ── Test Setup ────────────────────────────────────────────────────── */

let app: FastifyInstance;

beforeAll(async () => {
  app = Fastify();

  // Inject userId for all requests
  app.addHook("onRequest", async (req) => {
    (req as any).userId = 42;
  });

  await app.register(structuredExtractionPlugin, { prefix: "/api/extraction" });
  await app.ready();
});

beforeEach(() => {
  vi.clearAllMocks();
});

/* ── Tests ─────────────────────────────────────────────────────────── */

describe("structured-extraction routes", () => {

  // ─── POST /schemas ───────────────────────────────────────────────

  describe("POST /api/extraction/schemas", () => {
    it("should create a schema", async () => {
      const schema = { id: 1, name: "Products", userId: 42 };
      mockCreateSchema.mockResolvedValue(schema);

      const resp = await app.inject({
        method: "POST",
        url: "/api/extraction/schemas",
        payload: {
          name: "Products",
          schema: { fields: [{ name: "title", type: "string", required: true }] },
        },
      });

      expect(resp.statusCode).toBe(201);
      const body = resp.json();
      expect(body.success).toBe(true);
      expect(body.schema).toEqual(schema);
    });

    it("should reject invalid input", async () => {
      const resp = await app.inject({
        method: "POST",
        url: "/api/extraction/schemas",
        payload: { name: "" },
      });

      expect(resp.statusCode).toBe(400);
    });

    it("should reject missing fields", async () => {
      const resp = await app.inject({
        method: "POST",
        url: "/api/extraction/schemas",
        payload: { name: "Test", schema: { fields: [] } },
      });

      expect(resp.statusCode).toBe(400);
    });
  });

  // ─── GET /schemas ────────────────────────────────────────────────

  describe("GET /api/extraction/schemas", () => {
    it("should list schemas", async () => {
      const schemas = [{ id: 1, name: "Products" }];
      mockGetSchemas.mockResolvedValue(schemas);

      const resp = await app.inject({
        method: "GET",
        url: "/api/extraction/schemas",
      });

      expect(resp.statusCode).toBe(200);
      expect(resp.json().schemas).toEqual(schemas);
    });
  });

  // ─── PUT /schemas/:id ───────────────────────────────────────────

  describe("PUT /api/extraction/schemas/:id", () => {
    it("should update a schema", async () => {
      const updated = { id: 1, name: "Updated" };
      mockUpdateSchema.mockResolvedValue(updated);

      const resp = await app.inject({
        method: "PUT",
        url: "/api/extraction/schemas/1",
        payload: { name: "Updated" },
      });

      expect(resp.statusCode).toBe(200);
      expect(resp.json().schema).toEqual(updated);
    });

    it("should return 404 when not found", async () => {
      mockUpdateSchema.mockResolvedValue(null);

      const resp = await app.inject({
        method: "PUT",
        url: "/api/extraction/schemas/999",
        payload: { name: "X" },
      });

      expect(resp.statusCode).toBe(404);
    });

    it("should reject invalid ID", async () => {
      const resp = await app.inject({
        method: "PUT",
        url: "/api/extraction/schemas/abc",
        payload: { name: "X" },
      });

      expect(resp.statusCode).toBe(400);
    });
  });

  // ─── DELETE /schemas/:id ─────────────────────────────────────────

  describe("DELETE /api/extraction/schemas/:id", () => {
    it("should delete a schema", async () => {
      mockDeleteSchema.mockResolvedValue({ id: 1 });

      const resp = await app.inject({
        method: "DELETE",
        url: "/api/extraction/schemas/1",
      });

      expect(resp.statusCode).toBe(200);
      expect(resp.json().success).toBe(true);
    });

    it("should return 404 when not found", async () => {
      mockDeleteSchema.mockResolvedValue(null);

      const resp = await app.inject({
        method: "DELETE",
        url: "/api/extraction/schemas/999",
      });

      expect(resp.statusCode).toBe(404);
    });
  });

  // ─── POST /run ──────────────────────────────────────────────────

  describe("POST /api/extraction/run", () => {
    it("should run extraction", async () => {
      const job = { id: 1, status: "completed", extractedRows: 5 };
      mockRunExtraction.mockResolvedValue(job);

      const resp = await app.inject({
        method: "POST",
        url: "/api/extraction/run",
        payload: {
          schemaId: 1,
          url: "https://example.com",
        },
      });

      expect(resp.statusCode).toBe(201);
      expect(resp.json().job).toEqual(job);
    });

    it("should accept auth and pagination config", async () => {
      const job = { id: 2, status: "running" };
      mockRunExtraction.mockResolvedValue(job);

      const resp = await app.inject({
        method: "POST",
        url: "/api/extraction/run",
        payload: {
          schemaId: 1,
          url: "https://example.com/products",
          authConfig: { type: "bearer", credentials: { token: "abc" } },
          paginationConfig: { type: "page-number", maxPages: 3 },
        },
      });

      expect(resp.statusCode).toBe(201);
    });

    it("should reject invalid URL", async () => {
      const resp = await app.inject({
        method: "POST",
        url: "/api/extraction/run",
        payload: { schemaId: 1, url: "not-a-url" },
      });

      expect(resp.statusCode).toBe(400);
    });
  });

  // ─── GET /jobs ──────────────────────────────────────────────────

  describe("GET /api/extraction/jobs", () => {
    it("should list jobs", async () => {
      const jobs = [{ id: 1, status: "completed" }];
      mockGetExtractionJobs.mockResolvedValue(jobs);

      const resp = await app.inject({
        method: "GET",
        url: "/api/extraction/jobs",
      });

      expect(resp.statusCode).toBe(200);
      expect(resp.json().jobs).toEqual(jobs);
    });

    it("should filter by schemaId", async () => {
      mockGetExtractionJobs.mockResolvedValue([]);

      await app.inject({
        method: "GET",
        url: "/api/extraction/jobs?schemaId=5",
      });

      expect(mockGetExtractionJobs).toHaveBeenCalledWith(42, 5);
    });
  });

  // ─── GET /jobs/:id ──────────────────────────────────────────────

  describe("GET /api/extraction/jobs/:id", () => {
    it("should return job", async () => {
      const job = { id: 1, status: "completed" };
      mockGetExtractionJobById.mockResolvedValue(job);

      const resp = await app.inject({
        method: "GET",
        url: "/api/extraction/jobs/1",
      });

      expect(resp.statusCode).toBe(200);
      expect(resp.json().job).toEqual(job);
    });

    it("should return 404 when not found", async () => {
      mockGetExtractionJobById.mockResolvedValue(null);

      const resp = await app.inject({
        method: "GET",
        url: "/api/extraction/jobs/999",
      });

      expect(resp.statusCode).toBe(404);
    });
  });

  // ─── DELETE /jobs/:id ───────────────────────────────────────────

  describe("DELETE /api/extraction/jobs/:id", () => {
    it("should cancel a job", async () => {
      const cancelled = { id: 1, status: "failed", errorMessage: "Cancelled by user" };
      mockCancelExtraction.mockResolvedValue(cancelled);

      const resp = await app.inject({
        method: "DELETE",
        url: "/api/extraction/jobs/1",
      });

      expect(resp.statusCode).toBe(200);
      expect(resp.json().job.status).toBe("failed");
    });

    it("should return 400 for non-cancellable job", async () => {
      mockCancelExtraction.mockRejectedValue(new Error("Can only cancel pending or running jobs"));

      const resp = await app.inject({
        method: "DELETE",
        url: "/api/extraction/jobs/1",
      });

      expect(resp.statusCode).toBe(400);
    });
  });

  // ─── POST /preview ──────────────────────────────────────────────

  describe("POST /api/extraction/preview", () => {
    it("should preview extraction", async () => {
      const result = { rows: [{ title: "A" }], totalRows: 1, confidence: 0.9, warnings: [] };
      mockPreviewExtraction.mockResolvedValue(result);

      const resp = await app.inject({
        method: "POST",
        url: "/api/extraction/preview",
        payload: {
          url: "https://example.com",
          schema: { fields: [{ name: "title", type: "string" }] },
        },
      });

      expect(resp.statusCode).toBe(200);
      expect(resp.json().result).toEqual(result);
    });
  });

  // ─── GET /templates ─────────────────────────────────────────────

  describe("GET /api/extraction/templates", () => {
    it("should list templates", async () => {
      const templates = [{ name: "Products", category: "ecommerce" }];
      mockGetExtractionTemplates.mockResolvedValue(templates);

      const resp = await app.inject({
        method: "GET",
        url: "/api/extraction/templates",
      });

      expect(resp.statusCode).toBe(200);
      expect(resp.json().templates).toEqual(templates);
    });

    it("should pass category filter", async () => {
      mockGetExtractionTemplates.mockResolvedValue([]);

      await app.inject({
        method: "GET",
        url: "/api/extraction/templates?category=jobs",
      });

      expect(mockGetExtractionTemplates).toHaveBeenCalledWith("jobs");
    });
  });

  // ─── POST /infer-schema ─────────────────────────────────────────

  describe("POST /api/extraction/infer-schema", () => {
    it("should infer schema from URL", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        text: () => Promise.resolve("<html><body>Products</body></html>"),
      });

      const inferred = {
        suggestedName: "Product Listings",
        confidence: 0.85,
        fields: [{ name: "title", type: "string", required: true }],
      };
      mockInferSchemaFromUrl.mockResolvedValue(inferred);

      const resp = await app.inject({
        method: "POST",
        url: "/api/extraction/infer-schema",
        payload: { url: "https://example.com" },
      });

      expect(resp.statusCode).toBe(200);
      expect(resp.json().inferred).toEqual(inferred);
    });

    it("should return 502 when fetch fails", async () => {
      mockFetch.mockResolvedValue({ ok: false, status: 500 });

      const resp = await app.inject({
        method: "POST",
        url: "/api/extraction/infer-schema",
        payload: { url: "https://example.com/broken" },
      });

      expect(resp.statusCode).toBe(502);
    });
  });

  // ─── GET /jobs/:id/export ────────────────────────────────────────

  describe("GET /api/extraction/jobs/:id/export", () => {
    it("should export job results as JSON", async () => {
      mockExportResult.mockResolvedValue({
        data: '[{"title": "A"}]',
        contentType: "application/json",
        filename: "extraction-1.json",
      });

      const resp = await app.inject({
        method: "GET",
        url: "/api/extraction/jobs/1/export?format=json",
      });

      expect(resp.statusCode).toBe(200);
      expect(resp.headers["content-type"]).toContain("application/json");
    });

    it("should export as CSV", async () => {
      mockExportResult.mockResolvedValue({
        data: "title\nA",
        contentType: "text/csv",
        filename: "extraction-1.csv",
      });

      const resp = await app.inject({
        method: "GET",
        url: "/api/extraction/jobs/1/export?format=csv",
      });

      expect(resp.statusCode).toBe(200);
      expect(resp.headers["content-type"]).toContain("text/csv");
    });

    it("should return 400 on export error", async () => {
      mockExportResult.mockRejectedValue(new Error("Job has no results to export"));

      const resp = await app.inject({
        method: "GET",
        url: "/api/extraction/jobs/2/export",
      });

      expect(resp.statusCode).toBe(400);
    });
  });
});
