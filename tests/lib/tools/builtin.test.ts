import { describe, it, expect, vi, beforeEach } from "vitest";

// ---- Mock dependencies that builtin.ts imports at module level ----

// Mock the tool registry so registerTool captures registrations
const registeredTools = new Map<string, { definition: any; execute: Function }>();
vi.mock("../../../src/lib/tools/index.js", () => ({
  registerTool: vi.fn((def: any, exec: Function) => {
    registeredTools.set(def.name, { definition: def, execute: exec });
  }),
}));

// Mock execute_code tool
vi.mock("../../../src/lib/tools/execute_code.js", () => ({
  executeCodeTool: {
    definition: { name: "execute_code" },
    execute: vi.fn().mockResolvedValue("mock code result"),
  },
}));

// Mock env
vi.mock("../../../src/config/env.js", () => ({
  env: {
    TAVILY_API_KEY: "test-tavily-key",
    SERP_API_KEY: "test-serp-key",
  },
}));

// Mock skillExecutor
vi.mock("../../../src/lib/tools/skillExecutor.js", () => ({
  registerUserSkillsAsTools: vi.fn(),
}));

// Mock ssrf
vi.mock("../../../src/lib/ssrf.js", () => ({
  validateSafeUrl: vi.fn(async (url: string) => url),
}));

// Mock global fetch
const mockFetch = vi.fn();
globalThis.fetch = mockFetch as any;

// Force the module to load (and call registerTool for each tool)
// Use dynamic import once — the module-level registerTool calls fire on first import
await import("../../../src/lib/tools/builtin.js");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("builtin tools – safeEvalMath (via calculator tool)", () => {
  async function calc(expression: string): Promise<any> {
    const tool = registeredTools.get("calculator");
    expect(tool).toBeDefined();
    const raw = await tool!.execute({ expression });
    return JSON.parse(raw as string);
  }

  it("evaluates basic arithmetic: 2+3*4 = 14", async () => {
    const result = await calc("2+3*4");
    expect(result.result).toBe(14);
  });

  it("evaluates parentheses: (2+3)*4 = 20", async () => {
    const result = await calc("(2+3)*4");
    expect(result.result).toBe(20);
  });

  it("evaluates exponentiation: 2**3 = 8", async () => {
    const result = await calc("2**3");
    expect(result.result).toBe(8);
  });

  it("evaluates sqrt(16) = 4", async () => {
    const result = await calc("sqrt(16)");
    expect(result.result).toBe(4);
  });

  it("evaluates sin(0) = 0", async () => {
    const result = await calc("sin(0)");
    expect(result.result).toBe(0);
  });

  it("evaluates cos(0) = 1", async () => {
    const result = await calc("cos(0)");
    expect(result.result).toBe(1);
  });

  it("evaluates log(E) = 1 (natural log)", async () => {
    const result = await calc("log(E)");
    expect(result.result).toBeCloseTo(1, 10);
  });

  it("evaluates expressions with pi constant", async () => {
    const result = await calc("sin(pi/2)");
    expect(result.result).toBeCloseTo(1, 10);
  });

  it("evaluates negative numbers: -5+3 = -2", async () => {
    const result = await calc("-5+3");
    expect(result.result).toBe(-2);
  });

  it("evaluates modulo: 10%3 = 1", async () => {
    const result = await calc("10%3");
    expect(result.result).toBe(1);
  });

  it("returns error for disallowed characters (code injection)", async () => {
    const result = await calc("process.exit()");
    expect(result.error).toBeDefined();
  });

  it("returns error for unknown functions", async () => {
    const result = await calc("foobar(1)");
    expect(result.error).toBeDefined();
  });

  it("returns error for disallowed keywords like eval", async () => {
    const result = await calc("eval('1+1')");
    expect(result.error).toBeDefined();
  });
});

describe("builtin tools – registerBuiltinTools registers expected tools", () => {
  it("registers the calculator tool", () => {
    expect(registeredTools.has("calculator")).toBe(true);
  });

  it("registers the datetime tool", () => {
    expect(registeredTools.has("datetime")).toBe(true);
  });

  it("registers the web_search tool", () => {
    expect(registeredTools.has("web_search")).toBe(true);
  });

  it("registers the execute_code tool", () => {
    expect(registeredTools.has("execute_code")).toBe(true);
  });

  it("registers the read_webpage tool", () => {
    expect(registeredTools.has("read_webpage")).toBe(true);
  });

  it("registers the wikipedia tool", () => {
    expect(registeredTools.has("wikipedia")).toBe(true);
  });
});

describe("builtin tools – datetime tool", () => {
  it("returns current datetime in UTC by default", async () => {
    const tool = registeredTools.get("datetime");
    const raw = await tool!.execute({});
    const result = JSON.parse(raw as string);
    expect(result.timezone).toBe("UTC");
    expect(result.datetime).toBeDefined();
    expect(result.iso).toBeDefined();
    expect(typeof result.unix).toBe("number");
  });

  it("returns error for invalid timezone", async () => {
    const tool = registeredTools.get("datetime");
    const raw = await tool!.execute({ timezone: "Not/A/Timezone" });
    const result = JSON.parse(raw as string);
    expect(result.error).toBeDefined();
  });
});

describe("builtin tools – web_search tool", () => {
  it("calls Tavily API when TAVILY_API_KEY is set", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        results: [
          { title: "Test", url: "https://example.com", content: "Test content" },
        ],
      }),
    });

    const tool = registeredTools.get("web_search");
    const raw = await tool!.execute({ query: "test query" });
    const results = JSON.parse(raw as string);

    expect(results).toHaveLength(1);
    expect(results[0].title).toBe("Test");
    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.tavily.com/search",
      expect.objectContaining({ method: "POST" }),
    );
  });
});

describe("builtin tools – wikipedia tool", () => {
  it("returns article summary on success", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        title: "Node.js",
        extract: "Node.js is a JavaScript runtime.",
        content_urls: { desktop: { page: "https://en.wikipedia.org/wiki/Node.js" } },
      }),
    });

    const tool = registeredTools.get("wikipedia");
    const raw = await tool!.execute({ query: "Node.js" });
    const result = JSON.parse(raw as string);

    expect(result.title).toBe("Node.js");
    expect(result.extract).toContain("JavaScript runtime");
  });

  it("returns error when article not found", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 404 });

    const tool = registeredTools.get("wikipedia");
    const raw = await tool!.execute({ query: "xyznonexistent" });
    const result = JSON.parse(raw as string);

    expect(result.error).toContain("not found");
  });
});
