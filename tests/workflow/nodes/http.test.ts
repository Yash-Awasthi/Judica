import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../src/lib/ssrf.js", () => ({
  validateSafeUrl: vi.fn(async (url: string) => url),
}));

import { httpHandler } from "../../../src/workflow/nodes/http.handler.js";
import { validateSafeUrl } from "../../../src/lib/ssrf.js";
import type { NodeContext } from "../../../src/workflow/types.js";

function makeCtx(inputs: Record<string, unknown>, nodeData: Record<string, unknown>): NodeContext {
  return { inputs, nodeData, runId: "test-run", userId: 1 };
}

beforeEach(() => {
  vi.restoreAllMocks();
  (validateSafeUrl as ReturnType<typeof vi.fn>).mockImplementation(async (url: string) => url);
});

describe("httpHandler", () => {
  it("performs a GET request and returns JSON data", async () => {
    const mockResponse = {
      status: 200,
      headers: new Headers({ "content-type": "application/json" }),
      json: async () => ({ data: "ok" }),
      text: async () => '{"data":"ok"}',
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockResponse));

    const ctx = makeCtx({}, { url: "https://api.example.com/data", method: "GET" });
    const result = await httpHandler(ctx);

    expect(result.status).toBe(200);
    expect(result.data).toEqual({ data: "ok" });
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("performs a POST request with a JSON body", async () => {
    const mockResponse = {
      status: 201,
      headers: new Headers({ "content-type": "application/json" }),
      json: async () => ({ id: 1 }),
      text: async () => '{"id":1}',
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockResponse));

    const ctx = makeCtx({}, {
      url: "https://api.example.com/items",
      method: "POST",
      body: { name: "test" },
      headers: { "Content-Type": "application/json" },
    });
    const result = await httpHandler(ctx);

    expect(result.status).toBe(201);
    expect(result.data).toEqual({ id: 1 });

    const fetchCall = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(fetchCall[1].method).toBe("POST");
    expect(fetchCall[1].body).toBe(JSON.stringify({ name: "test" }));
  });

  it("returns text data for non-JSON responses", async () => {
    const mockResponse = {
      status: 200,
      headers: new Headers({ "content-type": "text/plain" }),
      json: async () => { throw new Error("not json"); },
      text: async () => "plain text response",
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockResponse));

    const ctx = makeCtx({}, { url: "https://example.com/text" });
    const result = await httpHandler(ctx);

    expect(result.status).toBe(200);
    expect(result.data).toBe("plain text response");
  });

  it("defaults method to GET", async () => {
    const mockResponse = {
      status: 200,
      headers: new Headers({ "content-type": "text/plain" }),
      json: async () => ({}),
      text: async () => "ok",
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockResponse));

    const ctx = makeCtx({}, { url: "https://example.com" });
    await httpHandler(ctx);

    const fetchCall = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(fetchCall[1].method).toBe("GET");
  });

  it("calls validateSafeUrl before fetching", async () => {
    const mockResponse = {
      status: 200,
      headers: new Headers({ "content-type": "text/plain" }),
      json: async () => ({}),
      text: async () => "ok",
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockResponse));

    const ctx = makeCtx({}, { url: "https://example.com/safe" });
    await httpHandler(ctx);

    expect(validateSafeUrl).toHaveBeenCalledWith("https://example.com/safe");
  });

  it("throws when validateSafeUrl rejects the URL", async () => {
    (validateSafeUrl as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("Hostname localhost is restricted"),
    );

    const ctx = makeCtx({}, { url: "http://localhost/admin" });
    await expect(httpHandler(ctx)).rejects.toThrow("restricted");
  });

  it("converts response headers to plain object", async () => {
    const mockResponse = {
      status: 200,
      headers: new Headers({ "content-type": "text/plain", "x-custom": "val" }),
      json: async () => ({}),
      text: async () => "ok",
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockResponse));

    const ctx = makeCtx({}, { url: "https://example.com" });
    const result = await httpHandler(ctx);

    expect(result.headers).toEqual(expect.objectContaining({
      "content-type": "text/plain",
      "x-custom": "val",
    }));
  });

  it("auto-sets Content-Type for object body when not provided", async () => {
    const mockResponse = {
      status: 200,
      headers: new Headers({ "content-type": "application/json" }),
      json: async () => ({}),
      text: async () => "{}",
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockResponse));

    const ctx = makeCtx({}, {
      url: "https://example.com",
      method: "POST",
      body: { key: "value" },
    });
    await httpHandler(ctx);

    const fetchCall = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(fetchCall[1].headers["Content-Type"]).toBe("application/json");
  });

  it("does not attach body to GET requests", async () => {
    const mockResponse = {
      status: 200,
      headers: new Headers({ "content-type": "text/plain" }),
      json: async () => ({}),
      text: async () => "ok",
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockResponse));

    const ctx = makeCtx({}, {
      url: "https://example.com",
      method: "GET",
      body: { shouldNot: "appear" },
    });
    await httpHandler(ctx);

    const fetchCall = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(fetchCall[1].body).toBeUndefined();
  });

  it("handles non-ok responses", async () => {
    const mockResponse = {
      status: 404,
      headers: new Headers({ "content-type": "text/plain" }),
      json: async () => ({}),
      text: async () => "Not Found",
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockResponse));

    const ctx = makeCtx({}, { url: "https://api.example.com/missing", method: "GET" });
    const result = await httpHandler(ctx);

    expect(result.status).toBe(404);
    expect(result.data).toBe("Not Found");
  });

  it("handles fetch errors", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Network timeout")));

    const ctx = makeCtx({}, { url: "https://api.example.com/slow", method: "GET" });
    await expect(httpHandler(ctx)).rejects.toThrow("Network timeout");
  });
});
