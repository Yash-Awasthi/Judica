import { z } from "zod";
import { env } from "../../config/env.js";
import logger from "../logger.js";

export const executeSearchSchema = z.object({
  query: z.string().max(1000).describe("The search query to execute"),
});

export const executeSearchDef = {
  name: "web_search",
  description: "Execute a web search to find current information, facts, or news.",
  parameters: {
    type: "object",
    properties: {
      query: { type: "string", description: "The search query to execute" },
    },
    required: ["query"],
  },
};

interface SerpResult {
  title: string;
  url: string;
  snippet: string;
}

function cleanSnippet(snippet: string): string {
  return snippet
    .replace(/\s+/g, " ") // Collapse multiple spaces/newlines
    .trim()
    .slice(0, 200); // Limit to ~200 chars
}

export async function executeSearch(args: unknown): Promise<string> {
  const parsed = executeSearchSchema.safeParse(args);
  if (!parsed.success) {
    logger.error({ error: parsed.error }, "Invalid search arguments");
    return "[]";
  }

  const query = parsed.data.query;
  const apiKey = env.SERP_API_KEY;

  if (!apiKey) {
    logger.warn("SERP_API_KEY not configured");
    return "[]";
  }

  // R4-02: Send API key in Authorization header rather than as a URL query parameter.
  // Query parameters are logged in access logs, HTTP referrer headers, and server-side
  // request logs — all of which would expose the key in plaintext.
  const params = new URLSearchParams({
    q: query,
    engine: "google",
  });

  const url = `https://serpapi.com/search.json?${params.toString()}`;

  const MAX_RESPONSE_SIZE = 5 * 1024 * 1024; // 5MB

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { Authorization: `Bearer ${apiKey}` },
    });

    if (!response.ok) {
      logger.warn({ status: response.status }, "SERP API error");
      return "[]";
    }

    const contentLength = Number(response.headers.get("content-length") || "0");
    if (contentLength > MAX_RESPONSE_SIZE) {
      logger.warn({ contentLength }, "SERP API response too large");
      return "[]";
    }

    const text = await response.text();
    if (text.length > MAX_RESPONSE_SIZE) {
      logger.warn("SERP API response body exceeded size limit");
      return "[]";
    }

    const data = JSON.parse(text) as {
      organic_results?: Array<{
        title?: string;
        link?: string;
        snippet?: string;
      }>;
    };

    const organicResults = data.organic_results || [];
    
    const seenUrls = new Set<string>();
    
    const results: SerpResult[] = organicResults
      .map((result) => ({
        title: (result.title || "").trim(),
        url: (result.link || "").trim(),
        snippet: cleanSnippet(result.snippet || ""),
      }))
      .filter((r) => {
        if (!r.title || !r.url) return false;
        
        if (seenUrls.has(r.url)) return false;
        seenUrls.add(r.url);
        
        return true;
      })
      .slice(0, 5); // Max 5 results

    return JSON.stringify(results);
  } catch (error) {
    const message = error instanceof Error ? error.message.replace(/api_key=[^&\s]*/gi, "api_key=***") : "Unknown error";
    logger.error({ error: message }, "Search failed");
    return "[]";
  }
}

export const searchTool = {
  definition: executeSearchDef,
  execute: executeSearch,
};
