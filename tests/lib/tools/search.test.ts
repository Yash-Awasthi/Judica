import { describe, it, expect, vi, beforeEach } from "vitest";

// ---- Mock dependencies ----
vi.mock("../../../src/config/env.js", () => ({
  env: { SERP_API_KEY: "test-serp-key" },
}));

vi.mock("../../../src/lib/logger.js", () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

const mockFetch = vi.fn();
globalThis.fetch = mockFetch as any;

import { executeSearch } from "../../../src/lib/tools/search.js";

describe("search – executeSearch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns search results from SerpAPI", async () => {
    const data = {
      organic_results: [
        { title: "Result 1", link: "https://example.com/1", snippet: "First result" },
        { title: "Result 2", link: "https://example.com/2", snippet: "Second result" },
      ],
    };
    mockFetch.mockResolvedValueOnce({
      ok: true,
      headers: { get: () => "100" },
      text: async () => JSON.stringify(data),
    });

    const raw = await executeSearch({ query: "test query" });
    const results = JSON.parse(raw);

    expect(results).toHaveLength(2);
    expect(results[0].title).toBe("Result 1");
    expect(results[0].url).toBe("https://example.com/1");
    expect(results[1].snippet).toBe("Second result");
  });

  it("deduplicates results by URL", async () => {
    const data = {
      organic_results: [
        { title: "Result A", link: "https://example.com/dup", snippet: "First" },
        { title: "Result B", link: "https://example.com/dup", snippet: "Duplicate" },
        { title: "Result C", link: "https://example.com/unique", snippet: "Unique" },
      ],
    };
    mockFetch.mockResolvedValueOnce({
      ok: true,
      headers: { get: () => "100" },
      text: async () => JSON.stringify(data),
    });

    const raw = await executeSearch({ query: "duplicates" });
    const results = JSON.parse(raw);

    expect(results).toHaveLength(2);
    expect(results[0].url).toBe("https://example.com/dup");
    expect(results[1].url).toBe("https://example.com/unique");
  });

  it("truncates snippets to 200 characters", async () => {
    const longSnippet = "A".repeat(500);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      headers: { get: () => "100" },
      text: async () => JSON.stringify({
        organic_results: [
          { title: "Long", link: "https://example.com/long", snippet: longSnippet },
        ],
      }),
    });

    const raw = await executeSearch({ query: "long snippet" });
    const results = JSON.parse(raw);

    expect(results[0].snippet.length).toBeLessThanOrEqual(200);
  });

  it("limits to max 5 results", async () => {
    const manyResults = Array.from({ length: 10 }, (_, i) => ({
      title: `Result ${i}`,
      link: `https://example.com/${i}`,
      snippet: `Snippet ${i}`,
    }));
    mockFetch.mockResolvedValueOnce({
      ok: true,
      headers: { get: () => "100" },
      text: async () => JSON.stringify({ organic_results: manyResults }),
    });

    const raw = await executeSearch({ query: "many results" });
    const results = JSON.parse(raw);

    expect(results.length).toBeLessThanOrEqual(5);
  });

  it("handles API failure gracefully by returning empty array", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500, headers: { get: () => "0" } });

    const raw = await executeSearch({ query: "fail" });

    expect(raw).toBe("[]");
  });

  it("handles network error gracefully", async () => {
    mockFetch.mockRejectedValueOnce(new Error("Network error"));

    const raw = await executeSearch({ query: "network fail" });

    expect(raw).toBe("[]");
  });

  it("returns empty array for invalid arguments", async () => {
    const raw = await executeSearch({ notQuery: "bad" });

    expect(raw).toBe("[]");
  });

  it("filters out results with empty title or URL", async () => {
    const data = {
      organic_results: [
        { title: "", link: "https://example.com/empty-title", snippet: "No title" },
        { title: "Has title", link: "", snippet: "No url" },
        { title: "Valid", link: "https://example.com/valid", snippet: "Good" },
      ],
    };
    mockFetch.mockResolvedValueOnce({
      ok: true,
      headers: { get: () => "100" },
      text: async () => JSON.stringify(data),
    });

    const raw = await executeSearch({ query: "filter" });
    const results = JSON.parse(raw);

    expect(results).toHaveLength(1);
    expect(results[0].title).toBe("Valid");
  });

  it("collapses whitespace in snippets", async () => {
    const data = {
      organic_results: [
        {
          title: "Spaced",
          link: "https://example.com/spaced",
          snippet: "has   multiple   spaces\n\nand  newlines",
        },
      ],
    };
    mockFetch.mockResolvedValueOnce({
      ok: true,
      headers: { get: () => "100" },
      text: async () => JSON.stringify(data),
    });

    const raw = await executeSearch({ query: "spaces" });
    const results = JSON.parse(raw);

    expect(results[0].snippet).not.toContain("  ");
    expect(results[0].snippet).not.toContain("\n");
  });
});
