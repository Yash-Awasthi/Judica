import { describe, it, expect, vi, beforeEach } from "vitest";

// ---- Mock dependencies ----
const mockValidateSafeUrl = vi.fn();
vi.mock("../../../src/lib/ssrf.js", () => ({
  validateSafeUrl: (...args: any[]) => mockValidateSafeUrl(...args),
}));

vi.mock("../../../src/lib/tools/index.js", () => ({
  registerTool: vi.fn(),
}));

const mockFetch = vi.fn();
globalThis.fetch = mockFetch as any;

import { readWebpageTool } from "../../../src/lib/tools/read_webpage.js";

describe("readWebpageTool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // By default, validateSafeUrl passes through
    mockValidateSafeUrl.mockImplementation(async (url: string) => url);
  });

  it("fetches and extracts text from HTML", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Map([["content-length", "100"]]),
      text: async () =>
        "<html><body><h1>Hello</h1><p>World content here.</p></body></html>",
    });

    const result = await readWebpageTool.execute({ url: "https://example.com" });

    expect(result).toContain("Hello");
    expect(result).toContain("World content here.");
    // Should not contain HTML tags
    expect(result).not.toContain("<h1>");
    expect(result).not.toContain("<p>");
  });

  it("strips script tags from content", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Map([["content-length", "200"]]),
      text: async () =>
        '<html><body><p>Visible</p><script>alert("xss")</script><p>Also visible</p></body></html>',
    });

    const result = await readWebpageTool.execute({ url: "https://example.com" });

    expect(result).toContain("Visible");
    expect(result).toContain("Also visible");
    expect(result).not.toContain("alert");
    expect(result).not.toContain("<script>");
  });

  it("strips style tags from content", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Map([["content-length", "200"]]),
      text: async () =>
        "<html><body><style>body { color: red; }</style><p>Styled text</p></body></html>",
    });

    const result = await readWebpageTool.execute({ url: "https://example.com" });

    expect(result).toContain("Styled text");
    expect(result).not.toContain("color: red");
    expect(result).not.toContain("<style>");
  });

  it("follows redirects with SSRF validation on each hop", async () => {
    // First fetch: redirect
    mockFetch
      .mockResolvedValueOnce({
        ok: false,
        status: 301,
        headers: new Map([["location", "https://example.com/final"]]),
      })
      // Second fetch: actual page
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Map([["content-length", "50"]]),
        text: async () => "<html><body><p>Final page</p></body></html>",
      });

    const result = await readWebpageTool.execute({ url: "https://example.com/redirect" });

    expect(result).toContain("Final page");
    // validateSafeUrl called for both the original and redirect URLs
    expect(mockValidateSafeUrl).toHaveBeenCalledTimes(2);
    expect(mockValidateSafeUrl).toHaveBeenCalledWith("https://example.com/redirect");
    expect(mockValidateSafeUrl).toHaveBeenCalledWith("https://example.com/final");
  });

  it("rejects SSRF-flagged URLs", async () => {
    mockValidateSafeUrl.mockRejectedValueOnce(
      new Error("URL resolves to a private/internal IP address")
    );

    const result = await readWebpageTool.execute({ url: "http://169.254.169.254/metadata" });

    expect(result).toContain("Error");
    expect(result).toContain("private/internal");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("truncates long content to 10000 chars plus truncation marker", async () => {
    const longBody = "A".repeat(20000);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Map([["content-length", "20100"]]),
      text: async () => `<html><body><p>${longBody}</p></body></html>`,
    });

    const result = await readWebpageTool.execute({ url: "https://example.com/long" });

    expect(result.length).toBeLessThanOrEqual(10100); // 10000 + "... [Truncated]"
    expect(result).toContain("[Truncated]");
  });

  it("returns error for HTTP error status", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      headers: new Map(),
    });

    const result = await readWebpageTool.execute({ url: "https://example.com/404" });

    expect(result).toContain("Error");
    expect(result).toContain("404");
  });

  it("returns error on too many redirects", async () => {
    // Set up 6 redirects (MAX_REDIRECTS is 5)
    for (let i = 0; i < 6; i++) {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 302,
        headers: new Map([["location", `https://example.com/redirect${i}`]]),
      });
    }

    const result = await readWebpageTool.execute({ url: "https://example.com/loop" });

    expect(result).toContain("Too many redirects");
  });

  it("returns error on fetch exception", async () => {
    mockValidateSafeUrl.mockResolvedValueOnce("https://example.com/timeout");
    mockFetch.mockRejectedValueOnce(new Error("AbortError: The operation was aborted"));

    const result = await readWebpageTool.execute({ url: "https://example.com/timeout" });

    expect(result).toContain("Error");
    expect(result).toContain("aborted");
  });

  it("has correct tool definition", () => {
    expect(readWebpageTool.definition.name).toBe("read_webpage");
    expect(readWebpageTool.definition.parameters.required).toContain("url");
  });
});
