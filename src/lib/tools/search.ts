import { ToolInstance } from "./index.js";
import { env } from "../../config/env.js";
import logger from "../logger.js";

export const searchTool: ToolInstance = {
  definition: {
    name: "web_search",
    description: "Search the web for real-time information, news, or specific facts.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "The search query to execute"
        }
      },
      required: ["query"]
    }
  },
  execute: async ({ query }: { query: string }) => {
    if (!env.TAVILY_API_KEY) {
      throw new Error("TAVILY_API_KEY is not configured");
    }

    try {
      const response = await fetch("https://api.tavily.com/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          api_key: env.TAVILY_API_KEY,
          query,
          search_depth: "basic",
          max_results: 3
        })
      });

      if (!response.ok) {
        throw new Error(`Search failed with status ${response.status}`);
      }

      const data = await response.json();
      return JSON.stringify(data.results.map((r: any) => ({
        title: r.title,
        url: r.url,
        content: r.content
      })));
    } catch (err: any) {
      logger.error({ err: err.message, query }, "Web search failed");
      return `Search failed: ${err.message}`;
    }
  }
};
