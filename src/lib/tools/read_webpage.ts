import { ToolInstance } from "./index.js";
import { validateSafeUrl } from "../ssrf.js";

export const readWebpageTool: ToolInstance = {
  definition: {
    name: "read_webpage",
    description: "Fetch and extract text content from a public webpage. Use this to follow up on web searches and read the actual contents of an article or site.",
    parameters: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description: "The absolute URL of the webpage to read"
        }
      },
      required: ["url"]
    }
  },
  execute: async (args: Record<string, unknown>) => {
    const url = args.url as string;
    try {
      let currentUrl = url;
      let res;
      let redirects = 0;
      const MAX_REDIRECTS = 5;

      while (redirects < MAX_REDIRECTS) {
        currentUrl = await validateSafeUrl(currentUrl);

        res = await fetch(currentUrl, {
          headers: {
            "User-Agent": "Council-Agent/1.0",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          },
          redirect: "manual", // Prevent automatic following to allow manual validation
          signal: AbortSignal.timeout(10000), // 10s timeout
        });

        // Handle redirect
        if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
          const location = res.headers.get("location");
          currentUrl = new URL(location!, currentUrl).toString();
          redirects++;
          continue;
        }

        break;
      }

      if (redirects >= MAX_REDIRECTS) {
        return `Error: Too many redirects`;
      }

      if (!res || !res.ok) {
        return `Error: Failed to fetch webpage. HTTP Status ${res ? res.status : 'Unknown'}`;
      }

      const contentLength = res.headers.get("content-length");
      if (contentLength && parseInt(contentLength, 10) > 5 * 1024 * 1024) {
        return "Error: Response exceeds 5MB size limit";
      }

      const html = await res.text();
      
      const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
      let content = bodyMatch ? bodyMatch[1] : html;

      content = content.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "");
      content = content.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, "");

      const text = content.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

      return text.length > 10000 ? text.slice(0, 10000) + "... [Truncated]" : text;
    } catch (err) {
      return `Error reading webpage ${url}: ${(err as Error).message}`;
    }
  }
};
