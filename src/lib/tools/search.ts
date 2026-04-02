import { z } from "zod";
import { env } from "../../config/env.js";

export const executeSearchSchema = z.object({
  query: z.string().describe("The search query to execute"),
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

/**
 * Free DuckDuckGo HTML Scraper for AI Council.
 * Does not require any API keys.
 */
export async function executeSearch(args: unknown): Promise<string> {
  const parsed = executeSearchSchema.safeParse(args);
  if (!parsed.success) {
    throw new Error(`Invalid arguments: ${parsed.error.message}`);
  }

  const query = parsed.data.query;

  // Try Tavily first if key is present
  if (env.TAVILY_API_KEY && env.TAVILY_API_KEY !== "tavily-api-placeholder") {
    try {
      const response = await fetch("https://api.tavily.com/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          api_key: env.TAVILY_API_KEY,
          query,
          search_depth: "basic",
          max_results: 5,
        }),
      });
      if (response.ok) {
        const data = await response.json();
        return `Search Results for "${query}" (Tavily):\n\n` + 
          data.results.map((r: any) => `Source: ${r.url}\nSnippet: ${r.content}`).join("\n\n");
      }
    } catch (err) {
      console.warn("Tavily search failed, falling back to DDG:", err);
    }
  }

  // Fallback to Free DuckDuckGo Scraper
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;

  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36",
        "Accept-Language": "en-US,en;q=0.9",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
      }
    });

    if (!response.ok) {
      throw new Error(`DuckDuckGo returned status ${response.status}`);
    }

    const html = await response.text();
    
    // Simple regex parsing of DDG HTML (no added dependencies required)
    const results: string[] = [];
    const regex = /<a class="result__url" href="([^"]+)".*?<\/a>.*?<a class="result__snippet[^>]*>(.*?)<\/a>/gs;
    
    let match;
    let count = 0;
    while ((match = regex.exec(html)) !== null && count < 5) {
      // Decode URL
      let link = match[1];
      if (link.startsWith("/l/?uddg=")) {
        try {
          link = decodeURIComponent(link.split("uddg=")[1].split("&")[0]);
        } catch {}
      }
      
      // Clean snippet HTML tags
      const snippet = match[2].replace(/<\/?[^>]+(>|$)/g, "").replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&amp;/g, "&").trim();
      
      if (link && snippet) {
        results.push(`Source: ${link}\nSnippet: ${snippet}`);
        count++;
      }
    }

    if (results.length === 0) {
      return `No results found for "${query}"`;
    }

    return `Search Results for "${query}":\n\n` + results.join("\n\n");
  } catch (error: any) {
    return `Search failed: ${error.message}`;
  }
}

export const searchTool = {
  definition: executeSearchDef,
  execute: executeSearch,
};
