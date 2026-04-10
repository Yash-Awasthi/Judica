import { registerTool } from "./index.js";
import { executeCodeTool } from "./execute_code.js";

registerTool(
  {
    name: "web_search",
    description: "Search the web for information on a given topic",
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
    return `Search results for "${query}": [Web search is not yet configured. Set up a search API provider to enable this tool.]`;
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
      const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
      const text = await response.text();
      const plain = text.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
      return plain.slice(0, 5000); // Limit to 5000 chars
    } catch (err) {
      return `Failed to fetch URL: ${(err as Error).message}`;
    }
  }
);

registerTool(
  {
    name: "calculator",
    description: "Evaluate a mathematical expression and return the result",
    parameters: {
      type: "object",
      properties: {
        expression: { type: "string", description: "The mathematical expression to evaluate (e.g. '2 + 2', '10 * 5')" }
      },
      required: ["expression"]
    }
  },
  async (args) => {
    const expression = args.expression as string;
    try {
      // Basic safety: only allow math characters
      if (!/^[0-9+\-*/().\s]+$/.test(expression)) {
        return "Error: Invalid characters in mathematical expression. Only digits and operators (+, -, *, /, (), .) are allowed.";
      }

      // Use isolated-vm via execute_code tool for safe evaluation
      const result = await executeCodeTool.execute({ code: expression });
      return `Result of ${expression} = ${result}`;
    } catch (err) {
      return `Failed to evaluate expression: ${(err as Error).message}`;
    }
  }
);

registerTool(
  {
    name: "get_current_time",
    description: "Get the current time and date",
    parameters: {
      type: "object",
      properties: {
        timezone: { type: "string", description: "Optional timezone (e.g. 'UTC', 'America/New_York'). Defaults to UTC." }
      },
      required: []
    }
  },
  async (args) => {
    const timezone = (args.timezone as string) || "UTC";
    try {
      const now = new Date();
      const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: timezone,
        dateStyle: 'full',
        timeStyle: 'long',
      });
      return `The current time in ${timezone} is: ${formatter.format(now)}`;
    } catch (err) {
      return `Failed to get current time (possibly invalid timezone): ${(err as Error).message}`;
    }
  }
);