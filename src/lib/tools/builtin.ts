import { registerTool } from "./index.js";
import { executeCodeTool } from "./execute_code.js";
import { env } from "../../config/env.js";
import { registerUserSkillsAsTools } from "./skillExecutor.js";
import { validateSafeUrl } from "../ssrf.js";

/**
 * Safe math expression evaluator — recursive descent parser.
 * No eval/Function usage.  Supports: +, -, *, /, %, **, parentheses,
 * function calls (sin, cos, sqrt, etc.), and named constants (pi, E).
 */
function safeEvalMath(
  expr: string,
  fns: Record<string, (...a: number[]) => number>,
  consts: Record<string, number>,
): number {
  let pos = 0;
  const src = expr.replace(/\s+/g, "");

  function peek(): string { return src[pos] || ""; }
  function consume(ch?: string): string {
    if (ch && src[pos] !== ch) throw new Error(`Expected '${ch}' at position ${pos}`);
    return src[pos++];
  }

  // expression = term (('+' | '-') term)*
  function parseExpr(): number {
    let val = parseTerm();
    while (peek() === "+" || peek() === "-") {
      const op = consume();
      const right = parseTerm();
      val = op === "+" ? val + right : val - right;
    }
    return val;
  }

  // term = power (('*' | '/' | '%') power)*
  function parseTerm(): number {
    let val = parsePower();
    while (peek() === "*" || peek() === "/" || peek() === "%") {
      const op = consume();
      const right = parsePower();
      if (op === "*") val *= right;
      else if (op === "/") val /= right;
      else val %= right;
    }
    return val;
  }

  // power = unary ('**' | '^' unary)*  (right-associative)
  function parsePower(): number {
    const base = parseUnary();
    if ((peek() === "*" && src[pos + 1] === "*") || peek() === "^") {
      if (peek() === "*") { consume(); consume(); } else { consume(); }
      return Math.pow(base, parsePower());
    }
    return base;
  }

  // unary = ('-' | '+') unary | atom
  function parseUnary(): number {
    if (peek() === "-") { consume(); return -parseUnary(); }
    if (peek() === "+") { consume(); return parseUnary(); }
    return parseAtom();
  }

  // atom = number | '(' expr ')' | identifier ( '(' args ')' )?
  function parseAtom(): number {
    // Parenthesized sub-expression
    if (peek() === "(") {
      consume("(");
      const val = parseExpr();
      consume(")");
      return val;
    }
    // Number literal
    if (/[0-9.]/.test(peek())) {
      let numStr = "";
      while (/[0-9.]/.test(peek())) numStr += consume();
      // Support scientific notation like 1e10
      if (peek() === "e" || peek() === "E") {
        numStr += consume();
        if (peek() === "+" || peek() === "-") numStr += consume();
        while (/[0-9]/.test(peek())) numStr += consume();
      }
      const n = Number(numStr);
      if (isNaN(n)) throw new Error(`Invalid number: ${numStr}`);
      return n;
    }
    // Identifier (function name or constant)
    if (/[a-zA-Z_]/.test(peek())) {
      let name = "";
      while (/[a-zA-Z0-9_]/.test(peek())) name += consume();
      // Function call
      if (peek() === "(") {
        consume("(");
        const fnArgs: number[] = [];
        if (peek() !== ")") {
          fnArgs.push(parseExpr());
          while (peek() === ",") { consume(); fnArgs.push(parseExpr()); }
        }
        consume(")");
        const fn = fns[name];
        if (!fn) throw new Error(`Unknown function: ${name}`);
        return fn(...fnArgs);
      }
      // Constant
      if (name in consts) return consts[name];
      throw new Error(`Unknown identifier: ${name}`);
    }
    throw new Error(`Unexpected character '${peek()}' at position ${pos}`);
  }

  const result = parseExpr();
  if (pos < src.length) throw new Error(`Unexpected character '${src[pos]}' at position ${pos}`);
  return result;
}

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
      // Strict validation: reject anything that could be code injection
      if (/[;{}[\]\\`$]/.test(expr)) {
        return JSON.stringify({ error: "Expression contains disallowed characters" });
      }
      if (/constructor|prototype|__proto__|this|global|process|require|import|eval|Function|window|document|fetch|setTimeout|setInterval/i.test(expr)) {
        return JSON.stringify({ error: "Expression contains disallowed keywords" });
      }

      const mathFunctions: Record<string, (...args: number[]) => number> = {
        abs: Math.abs, ceil: Math.ceil, floor: Math.floor, round: Math.round,
        sqrt: Math.sqrt, cbrt: Math.cbrt, pow: Math.pow,
        sin: Math.sin, cos: Math.cos, tan: Math.tan,
        asin: Math.asin, acos: Math.acos, atan: Math.atan, atan2: Math.atan2,
        log: Math.log, log2: Math.log2, log10: Math.log10,
        exp: Math.exp, min: Math.min, max: Math.max,
      };
      const mathConstants: Record<string, number> = {
        PI: Math.PI, pi: Math.PI, E: Math.E, e: Math.E,
        Infinity: Infinity, NaN: NaN,
      };

      // Tokenize and evaluate using a safe recursive descent parser
      const result = safeEvalMath(expr, mathFunctions, mathConstants);

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
