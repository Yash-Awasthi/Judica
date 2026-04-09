import { registerTool } from "./index.js";
import { executeCodeTool } from "./execute_code.js";
import { env } from "../../config/env.js";
import { registerUserSkillsAsTools } from "./skillExecutor.js";
import { validateSafeUrl } from "../ssrf.js";

// Register user skills as callable tools on startup (lazy, per-request)
// Skills are loaded dynamically when the tool is called
registerUserSkillsAsTools();

registerTool(
  {
    name: "web_search",
    description: "Search the web for current information, facts, or news",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "The search query" }
      },
      required: ["query"]
    }
  },
  async (args) => {
    const query = args.query as string;

    // Try Tavily first
    if (env.TAVILY_API_KEY) {
      try {
        const res = await fetch("https://api.tavily.com/search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            api_key: env.TAVILY_API_KEY,
            query,
            max_results: 5,
            search_depth: "basic"
          }),
          signal: AbortSignal.timeout(10000)
        });
        if (res.ok) {
          const data = await res.json();
          const results = (data.results || []).map((r: any) => ({
            title: r.title,
            url: r.url,
            content: (r.content || "").slice(0, 300)
          }));
          return JSON.stringify(results);
        }
      } catch { /* fall through */ }
    }

    // Fall back to SerpAPI
    if (env.SERP_API_KEY) {
      const { executeSearch } = await import("./search.js");
      return executeSearch({ query });
    }

    return `Search results for "${query}": [Web search is not configured. Set TAVILY_API_KEY or SERP_API_KEY to enable.]`;
  }
);

registerTool(
  {
    name: "execute_code",
    description: "Execute a snippet of JavaScript code in a sandboxed environment and return the result",
    parameters: {
      type: "object",
      properties: {
        code: { type: "string", description: "The JavaScript code to execute" }
      },
      required: ["code"]
    }
  },
  async (args) => {
    return await executeCodeTool.execute(args);
  }
);

registerTool(
  {
    name: "read_webpage",
    description: "Fetch and extract text content from a URL",
    parameters: {
      type: "object",
      properties: {
        url: { type: "string", description: "The URL to fetch" }
      },
      required: ["url"]
    }
  },
  async (args) => {
    const url = args.url as string;
    try {
      // Validate URL against SSRF before fetching
      const safeUrl = await validateSafeUrl(url);
      const response = await fetch(safeUrl, {
        signal: AbortSignal.timeout(10000),
        redirect: "manual", // Prevent redirect-based SSRF bypass
      });
      // If redirect, validate the redirect target too
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (location) {
          const safeRedirect = await validateSafeUrl(location);
          const redirectResponse = await fetch(safeRedirect, { signal: AbortSignal.timeout(10000) });
          const text = await redirectResponse.text();
          const plain = text.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
          return plain.slice(0, 5000);
        }
      }
      const text = await response.text();
      const plain = text.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
      return plain.slice(0, 5000);
    } catch (err) {
      return `Failed to fetch URL: ${(err as Error).message}`;
    }
  }
);

registerTool(
  {
    name: "calculator",
    description: "Evaluate a mathematical expression. Supports basic arithmetic, exponents, trigonometry, logarithms.",
    parameters: {
      type: "object",
      properties: {
        expression: { type: "string", description: "The mathematical expression to evaluate (e.g., '2 + 3 * 4', 'sqrt(16)', 'sin(pi/2)')" }
      },
      required: ["expression"]
    }
  },
  async (args) => {
    const expr = args.expression as string;
    try {
      // Strict allowlist: only digits, math operators, parens, dots, commas, spaces,
      // and known math function/constant names
      const allowedNames = [
        'abs', 'ceil', 'floor', 'round', 'sqrt', 'cbrt', 'pow',
        'sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'atan2',
        'log', 'log2', 'log10', 'exp', 'min', 'max',
        'PI', 'pi', 'E', 'Infinity', 'NaN'
      ];
      // Remove all known function/constant names first, then check remainder
      let check = expr;
      for (const name of allowedNames) {
        check = check.replaceAll(name, '');
      }
      // After removing known names, only digits, operators, spaces, parens, dots, commas should remain
      if (/[a-zA-Z_]/.test(check)) {
        return JSON.stringify({ error: "Expression contains disallowed identifiers" });
      }
      // Also block known dangerous patterns
      if (/constructor|prototype|__proto__|this|global|process|require|import|eval|Function/i.test(expr)) {
        return JSON.stringify({ error: "Expression contains disallowed keywords" });
      }
      const mathScope: Record<string, any> = {
        abs: Math.abs, ceil: Math.ceil, floor: Math.floor, round: Math.round,
        sqrt: Math.sqrt, cbrt: Math.cbrt, pow: Math.pow,
        sin: Math.sin, cos: Math.cos, tan: Math.tan,
        asin: Math.asin, acos: Math.acos, atan: Math.atan, atan2: Math.atan2,
        log: Math.log, log2: Math.log2, log10: Math.log10,
        exp: Math.exp, min: Math.min, max: Math.max,
        PI: Math.PI, pi: Math.PI, E: Math.E, e: Math.E,
        Infinity, NaN
      };
      // Freeze scope objects to prevent prototype traversal
      const keys = Object.keys(mathScope);
      const vals = Object.values(mathScope);
      const sanitized = expr.replace(/[^0-9+\-*/().,%^ a-zA-Z_]/g, '');
      const fn = new Function(...keys, `"use strict"; return (${sanitized});`);
      const result = fn(...vals);
      if (typeof result !== 'number' || !isFinite(result)) {
        return JSON.stringify({ error: "Expression did not evaluate to a finite number", result: String(result) });
      }
      return JSON.stringify({ result });
    } catch (err) {
      return JSON.stringify({ error: `Failed to evaluate: ${(err as Error).message}` });
    }
  }
);

registerTool(
  {
    name: "datetime",
    description: "Get the current date and time, optionally in a specific timezone",
    parameters: {
      type: "object",
      properties: {
        timezone: { type: "string", description: "IANA timezone name (e.g., 'America/New_York', 'Europe/London', 'Asia/Tokyo'). Defaults to UTC." }
      },
      required: []
    }
  },
  async (args) => {
    const tz = (args.timezone as string) || "UTC";
    try {
      const now = new Date();
      const formatted = now.toLocaleString("en-US", {
        timeZone: tz,
        weekday: "long", year: "numeric", month: "long", day: "numeric",
        hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false
      });
      return JSON.stringify({ datetime: formatted, timezone: tz, iso: now.toISOString(), unix: Math.floor(now.getTime() / 1000) });
    } catch (err) {
      return JSON.stringify({ error: `Invalid timezone "${tz}": ${(err as Error).message}` });
    }
  }
);

registerTool(
  {
    name: "wikipedia",
    description: "Look up a topic on Wikipedia and get a summary",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "The topic to look up on Wikipedia" }
      },
      required: ["query"]
    }
  },
  async (args) => {
    const query = args.query as string;
    try {
      const encoded = encodeURIComponent(query.replace(/ /g, "_"));
      const res = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encoded}`, {
        headers: { "User-Agent": "AIBYAI/1.0 (council deliberation platform)" },
        signal: AbortSignal.timeout(10000)
      });
      if (!res.ok) {
        return JSON.stringify({ error: `Wikipedia article not found for "${query}"` });
      }
      const data: any = await res.json();
      return JSON.stringify({
        title: data.title,
        extract: data.extract || "",
        url: data.content_urls?.desktop?.page || `https://en.wikipedia.org/wiki/${encoded}`
      });
    } catch (err) {
      return JSON.stringify({ error: `Wikipedia lookup failed: ${(err as Error).message}` });
    }
  }
);
