import { describe, it, expect, vi, beforeEach } from "vitest";

/* ── Hoisted mocks (must be declared before vi.mock factories) ────── */

const {
  mockDb,
  mockGenerateCandidateSelectors,
  mockSelfHealingResolve,
  mockExtractWithSelector,
  mockScoreSelectorConfidence,
  mockFetch,
} = vi.hoisted(() => ({
  mockDb: {} as Record<string, any>,
  mockGenerateCandidateSelectors: vi.fn(),
  mockSelfHealingResolve: vi.fn(),
  mockExtractWithSelector: vi.fn(),
  mockScoreSelectorConfidence: vi.fn(),
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

vi.mock("../../src/db/schema/webSelectors.js", () => ({
  webSelectors: {
    id: "webSelectors.id",
    userId: "webSelectors.userId",
    name: "webSelectors.name",
    description: "webSelectors.description",
    url: "webSelectors.url",
    resolvedSelector: "webSelectors.resolvedSelector",
    selectorType: "webSelectors.selectorType",
    confidence: "webSelectors.confidence",
    lastResolvedAt: "webSelectors.lastResolvedAt",
    failCount: "webSelectors.failCount",
    createdAt: "webSelectors.createdAt",
    updatedAt: "webSelectors.updatedAt",
  },
  webSelectorExecutions: {
    id: "webSelectorExecutions.id",
    selectorId: "webSelectorExecutions.selectorId",
    url: "webSelectorExecutions.url",
    success: "webSelectorExecutions.success",
    resolvedSelector: "webSelectorExecutions.resolvedSelector",
    extractedContent: "webSelectorExecutions.extractedContent",
    executionTimeMs: "webSelectorExecutions.executionTimeMs",
    errorMessage: "webSelectorExecutions.errorMessage",
    createdAt: "webSelectorExecutions.createdAt",
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

vi.mock("../../src/lib/selectorEngine.js", () => ({
  generateCandidateSelectors: mockGenerateCandidateSelectors,
  selfHealingResolve: mockSelfHealingResolve,
  extractWithSelector: mockExtractWithSelector,
  scoreSelectorConfidence: mockScoreSelectorConfidence,
  inferSelectorType: vi.fn((s: string) => {
    if (s.startsWith("//")) return "xpath";
    if (s.includes("role=")) return "aria";
    return "css";
  }),
}));

// Mock global fetch
(globalThis as any).fetch = mockFetch;

import {
  createSelector,
  getSelectors,
  getSelectorById,
  updateSelector,
  deleteSelector,
  resolveSelector,
  getSelectorExecutions,
  validateSelector,
} from "../../src/services/webSelectors.service.js";

/* ── Tests ─────────────────────────────────────────────────────────── */

describe("webSelectors.service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ─── CRUD ──────────────────────────────────────────────────────────

  describe("createSelector", () => {
    it("should insert a new selector and return it", async () => {
      const mockSelector = {
        id: 1,
        userId: 42,
        name: "Search input",
        description: "the main search input field",
        url: null,
        selectorType: "css",
        resolvedSelector: null,
        confidence: 0,
        failCount: 0,
      };

      const chain = chainable({
        returning: vi.fn(() => [mockSelector]),
      });
      mockDb.insert = vi.fn(() => chain);

      const result = await createSelector(42, {
        name: "Search input",
        description: "the main search input field",
      });

      expect(result).toEqual(mockSelector);
      expect(mockDb.insert).toHaveBeenCalled();
    });
  });

  describe("getSelectors", () => {
    it("should return selectors for a user", async () => {
      const mockSelectors = [
        { id: 1, userId: 42, name: "Search input" },
        { id: 2, userId: 42, name: "Price element" },
      ];

      const chain = chainable();
      chain.orderBy = vi.fn(() => mockSelectors);
      mockDb.select = vi.fn(() => chain);

      const result = await getSelectors(42);
      expect(result).toEqual(mockSelectors);
    });
  });

  describe("getSelectorById", () => {
    it("should return selector if found", async () => {
      const mockSelector = { id: 1, userId: 42, name: "Test" };
      const chain = chainable({
        limit: vi.fn(() => [mockSelector]),
      });
      mockDb.select = vi.fn(() => chain);

      const result = await getSelectorById(1, 42);
      expect(result).toEqual(mockSelector);
    });

    it("should return null if not found", async () => {
      const chain = chainable({
        limit: vi.fn(() => []),
      });
      mockDb.select = vi.fn(() => chain);

      const result = await getSelectorById(999, 42);
      expect(result).toBeNull();
    });
  });

  describe("updateSelector", () => {
    it("should update and return the selector", async () => {
      const updated = { id: 1, userId: 42, name: "Updated" };
      const chain = chainable({
        returning: vi.fn(() => [updated]),
      });
      mockDb.update = vi.fn(() => chain);

      const result = await updateSelector(1, 42, { name: "Updated" });
      expect(result).toEqual(updated);
    });

    it("should return null if selector not found", async () => {
      const chain = chainable({
        returning: vi.fn(() => []),
      });
      mockDb.update = vi.fn(() => chain);

      const result = await updateSelector(999, 42, { name: "Updated" });
      expect(result).toBeNull();
    });
  });

  describe("deleteSelector", () => {
    it("should delete executions and selector, returning deleted", async () => {
      const deleted = { id: 1, userId: 42, name: "Deleted" };
      const deleteChain = chainable();
      const deleteChain2 = chainable({
        returning: vi.fn(() => [deleted]),
      });

      let callCount = 0;
      mockDb.delete = vi.fn(() => {
        callCount++;
        return callCount === 1 ? deleteChain : deleteChain2;
      });

      const result = await deleteSelector(1, 42);
      expect(result).toEqual(deleted);
      expect(mockDb.delete).toHaveBeenCalledTimes(2);
    });
  });

  // ─── Resolution ────────────────────────────────────────────────────

  describe("resolveSelector", () => {
    it("should resolve description to selector using LLM", async () => {
      const candidates = [
        { selector: "#search-box input", type: "css", confidence: 0.9, reasoning: "id match" },
        { selector: "//input[@name='q']", type: "xpath", confidence: 0.7, reasoning: "xpath match" },
      ];

      mockGenerateCandidateSelectors.mockResolvedValue(candidates);
      mockScoreSelectorConfidence.mockReturnValue(0.85);

      const result = await resolveSelector("search input", undefined, "<html><body><div id='search-box'><input name='q'></div></body></html>");

      expect(result.candidates.length).toBe(2);
      expect(result.bestSelector).toBe("#search-box input");
      expect(result.bestType).toBe("css");
      expect(result.confidence).toBeGreaterThan(0);
    });

    it("should fetch page if URL is provided but no HTML", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        text: vi.fn().mockResolvedValue("<html><body><div>test</div></body></html>"),
      });

      mockGenerateCandidateSelectors.mockResolvedValue([
        { selector: "div", type: "css", confidence: 0.5, reasoning: "tag match" },
      ]);
      mockScoreSelectorConfidence.mockReturnValue(0.5);

      const result = await resolveSelector("main content", "https://example.com");
      expect(mockFetch).toHaveBeenCalled();
      expect(result.candidates.length).toBe(1);
    });

    it("should return empty result if no HTML and no URL", async () => {
      const result = await resolveSelector("something");
      expect(result.candidates).toEqual([]);
      expect(result.bestSelector).toBeNull();
    });
  });

  // ─── Execution History ─────────────────────────────────────────────

  describe("getSelectorExecutions", () => {
    it("should return execution history ordered by date", async () => {
      const executions = [
        { id: 1, selectorId: 1, success: true },
        { id: 2, selectorId: 1, success: false },
      ];
      const chain = chainable({
        limit: vi.fn(() => executions),
      });
      mockDb.select = vi.fn(() => chain);

      const result = await getSelectorExecutions(1);
      expect(result).toEqual(executions);
    });
  });

  // ─── Validation ────────────────────────────────────────────────────

  describe("validateSelector", () => {
    it("should delegate to extractWithSelector", () => {
      mockExtractWithSelector.mockReturnValue({
        matched: true,
        content: "test content",
        matchCount: 1,
      });

      const result = validateSelector(".test", "css", "<div class='test'>test content</div>");
      expect(result.matched).toBe(true);
      expect(mockExtractWithSelector).toHaveBeenCalledWith(
        "<div class='test'>test content</div>",
        ".test",
        "css",
      );
    });
  });
});
