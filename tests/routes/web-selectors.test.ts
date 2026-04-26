import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";
import Fastify from "fastify";
import type { FastifyInstance } from "fastify";

/* ── Hoisted mocks ─────────────────────────────────────────────────── */

const {
  mockCreateSelector,
  mockGetSelectors,
  mockGetSelectorById,
  mockUpdateSelector,
  mockDeleteSelector,
  mockResolveSelector,
  mockExecuteSelector,
  mockBatchExecute,
  mockSelfHealSelector,
  mockGetSelectorExecutions,
  mockGenerateSelectorFromExamples,
  mockValidateSelector,
} = vi.hoisted(() => ({
  mockCreateSelector: vi.fn(),
  mockGetSelectors: vi.fn(),
  mockGetSelectorById: vi.fn(),
  mockUpdateSelector: vi.fn(),
  mockDeleteSelector: vi.fn(),
  mockResolveSelector: vi.fn(),
  mockExecuteSelector: vi.fn(),
  mockBatchExecute: vi.fn(),
  mockSelfHealSelector: vi.fn(),
  mockGetSelectorExecutions: vi.fn(),
  mockGenerateSelectorFromExamples: vi.fn(),
  mockValidateSelector: vi.fn(),
}));

vi.mock("../../src/services/webSelectors.service.js", () => ({
  createSelector: mockCreateSelector,
  getSelectors: mockGetSelectors,
  getSelectorById: mockGetSelectorById,
  updateSelector: mockUpdateSelector,
  deleteSelector: mockDeleteSelector,
  resolveSelector: mockResolveSelector,
  executeSelector: mockExecuteSelector,
  batchExecute: mockBatchExecute,
  selfHealSelector: mockSelfHealSelector,
  getSelectorExecutions: mockGetSelectorExecutions,
  generateSelectorFromExamples: mockGenerateSelectorFromExamples,
  validateSelector: mockValidateSelector,
}));

import { webSelectorsPlugin } from "../../src/routes/web-selectors.js";

/* ── Test Setup ────────────────────────────────────────────────────── */

let app: FastifyInstance;

beforeAll(async () => {
  app = Fastify();

  // Inject userId for all requests
  app.addHook("onRequest", async (req) => {
    (req as any).userId = 42;
  });

  await app.register(webSelectorsPlugin, { prefix: "/api" });
  await app.ready();
});

beforeEach(() => {
  vi.clearAllMocks();
});

/* ── Tests ─────────────────────────────────────────────────────────── */

describe("web-selectors routes", () => {
  // ─── POST /web-selectors ──────────────────────────────────────────

  describe("POST /api/web-selectors", () => {
    it("should create a selector", async () => {
      const selector = { id: 1, name: "Search", description: "search input", userId: 42 };
      mockCreateSelector.mockResolvedValue(selector);

      const res = await app.inject({
        method: "POST",
        url: "/api/web-selectors",
        payload: { name: "Search", description: "search input" },
      });

      expect(res.statusCode).toBe(201);
      const body = JSON.parse(res.body);
      expect(body.success).toBe(true);
      expect(body.selector.name).toBe("Search");
      expect(mockCreateSelector).toHaveBeenCalledWith(42, {
        name: "Search",
        description: "search input",
      });
    });

    it("should return 400 for missing required fields", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/web-selectors",
        payload: { name: "" },
      });

      expect(res.statusCode).toBe(400);
    });

    it("should accept optional url and selectorType", async () => {
      const selector = { id: 2, name: "Price", description: "product price", url: "https://example.com", selectorType: "xpath" };
      mockCreateSelector.mockResolvedValue(selector);

      const res = await app.inject({
        method: "POST",
        url: "/api/web-selectors",
        payload: {
          name: "Price",
          description: "product price",
          url: "https://example.com",
          selectorType: "xpath",
        },
      });

      expect(res.statusCode).toBe(201);
    });
  });

  // ─── GET /web-selectors ───────────────────────────────────────────

  describe("GET /api/web-selectors", () => {
    it("should list selectors for the user", async () => {
      const selectors = [
        { id: 1, name: "Search" },
        { id: 2, name: "Price" },
      ];
      mockGetSelectors.mockResolvedValue(selectors);

      const res = await app.inject({
        method: "GET",
        url: "/api/web-selectors",
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.success).toBe(true);
      expect(body.selectors).toHaveLength(2);
    });
  });

  // ─── PUT /web-selectors/:id ───────────────────────────────────────

  describe("PUT /api/web-selectors/:id", () => {
    it("should update a selector", async () => {
      const updated = { id: 1, name: "Updated Search" };
      mockUpdateSelector.mockResolvedValue(updated);

      const res = await app.inject({
        method: "PUT",
        url: "/api/web-selectors/1",
        payload: { name: "Updated Search" },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.success).toBe(true);
      expect(body.selector.name).toBe("Updated Search");
    });

    it("should return 404 if not found", async () => {
      mockUpdateSelector.mockResolvedValue(null);

      const res = await app.inject({
        method: "PUT",
        url: "/api/web-selectors/999",
        payload: { name: "Updated" },
      });

      expect(res.statusCode).toBe(404);
    });
  });

  // ─── DELETE /web-selectors/:id ────────────────────────────────────

  describe("DELETE /api/web-selectors/:id", () => {
    it("should delete a selector", async () => {
      mockDeleteSelector.mockResolvedValue({ id: 1 });

      const res = await app.inject({
        method: "DELETE",
        url: "/api/web-selectors/1",
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.success).toBe(true);
    });

    it("should return 404 if not found", async () => {
      mockDeleteSelector.mockResolvedValue(null);

      const res = await app.inject({
        method: "DELETE",
        url: "/api/web-selectors/999",
      });

      expect(res.statusCode).toBe(404);
    });
  });

  // ─── POST /web-selectors/resolve ──────────────────────────────────

  describe("POST /api/web-selectors/resolve", () => {
    it("should resolve NL description to selectors", async () => {
      mockResolveSelector.mockResolvedValue({
        candidates: [
          { selector: "#search", type: "css", confidence: 0.9, reasoning: "id match" },
        ],
        bestSelector: "#search",
        bestType: "css",
        confidence: 0.9,
      });

      const res = await app.inject({
        method: "POST",
        url: "/api/web-selectors/resolve",
        payload: {
          description: "the search box",
          url: "https://example.com",
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.success).toBe(true);
      expect(body.bestSelector).toBe("#search");
      expect(body.candidates).toHaveLength(1);
    });

    it("should accept html instead of url", async () => {
      mockResolveSelector.mockResolvedValue({
        candidates: [],
        bestSelector: null,
        bestType: "css",
        confidence: 0,
      });

      const res = await app.inject({
        method: "POST",
        url: "/api/web-selectors/resolve",
        payload: {
          description: "the title",
          html: "<html><h1>Test</h1></html>",
        },
      });

      expect(res.statusCode).toBe(200);
    });

    it("should return 400 for missing description", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/web-selectors/resolve",
        payload: {},
      });

      expect(res.statusCode).toBe(400);
    });
  });

  // ─── POST /web-selectors/:id/execute ──────────────────────────────

  describe("POST /api/web-selectors/:id/execute", () => {
    it("should execute selector and return result", async () => {
      mockExecuteSelector.mockResolvedValue({
        success: true,
        selector: ".product-price",
        selectorType: "css",
        content: "$29.99",
        confidence: 0.85,
        executionTimeMs: 150,
      });

      const res = await app.inject({
        method: "POST",
        url: "/api/web-selectors/1/execute",
        payload: { url: "https://example.com/products" },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.success).toBe(true);
      expect(body.execution.content).toBe("$29.99");
    });

    it("should require url", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/web-selectors/1/execute",
        payload: {},
      });

      expect(res.statusCode).toBe(400);
    });
  });

  // ─── POST /web-selectors/batch ────────────────────────────────────

  describe("POST /api/web-selectors/batch", () => {
    it("should batch execute and return results", async () => {
      mockBatchExecute.mockResolvedValue([
        { success: true, selector: ".title", content: "Test" },
        { success: true, selector: ".price", content: "$10" },
      ]);

      const res = await app.inject({
        method: "POST",
        url: "/api/web-selectors/batch",
        payload: {
          selectorIds: [1, 2],
          url: "https://example.com",
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.results).toHaveLength(2);
    });

    it("should reject empty selectorIds", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/web-selectors/batch",
        payload: {
          selectorIds: [],
          url: "https://example.com",
        },
      });

      expect(res.statusCode).toBe(400);
    });
  });

  // ─── POST /web-selectors/:id/heal ─────────────────────────────────

  describe("POST /api/web-selectors/:id/heal", () => {
    it("should self-heal a broken selector", async () => {
      mockSelfHealSelector.mockResolvedValue({
        success: true,
        selector: ".new-product-price",
        selectorType: "css",
        content: "$29.99",
        confidence: 0.8,
        executionTimeMs: 500,
      });

      const res = await app.inject({
        method: "POST",
        url: "/api/web-selectors/1/heal",
        payload: { url: "https://example.com" },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.success).toBe(true);
      expect(body.execution.selector).toBe(".new-product-price");
    });
  });

  // ─── GET /web-selectors/:id/history ────────────────────────────────

  describe("GET /api/web-selectors/:id/history", () => {
    it("should return execution history", async () => {
      mockGetSelectorById.mockResolvedValue({ id: 1, userId: 42 });
      mockGetSelectorExecutions.mockResolvedValue([
        { id: 1, selectorId: 1, success: true },
        { id: 2, selectorId: 1, success: false },
      ]);

      const res = await app.inject({
        method: "GET",
        url: "/api/web-selectors/1/history",
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.executions).toHaveLength(2);
    });

    it("should return 404 if selector not found", async () => {
      mockGetSelectorById.mockResolvedValue(null);

      const res = await app.inject({
        method: "GET",
        url: "/api/web-selectors/999/history",
      });

      expect(res.statusCode).toBe(404);
    });
  });

  // ─── POST /web-selectors/from-examples ─────────────────────────────

  describe("POST /api/web-selectors/from-examples", () => {
    it("should generate cross-site selector", async () => {
      mockGenerateSelectorFromExamples.mockResolvedValue({
        candidates: [
          { selector: ".price", type: "css", confidence: 0.8, reasoning: "common class" },
        ],
        bestSelector: ".price",
        bestType: "css",
        confidence: 0.8,
      });

      const res = await app.inject({
        method: "POST",
        url: "/api/web-selectors/from-examples",
        payload: {
          description: "product price",
          exampleUrls: ["https://shop1.com", "https://shop2.com"],
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.bestSelector).toBe(".price");
    });
  });

  // ─── POST /web-selectors/validate ──────────────────────────────────

  describe("POST /api/web-selectors/validate", () => {
    it("should validate a selector against HTML", async () => {
      mockValidateSelector.mockReturnValue({
        matched: true,
        content: "test",
        matchCount: 1,
      });

      const res = await app.inject({
        method: "POST",
        url: "/api/web-selectors/validate",
        payload: {
          selector: ".test",
          selectorType: "css",
          html: "<div class='test'>test</div>",
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.matched).toBe(true);
    });
  });
});
