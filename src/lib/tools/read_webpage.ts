import type { ToolInstance } from "./index.js";
import { validateSafeUrl } from "../ssrf.js";

/**
 * Remove all occurrences of a block-level tag and its content using indexOf
 * scanning.  Avoids regex-based HTML filtering flagged by CodeQL
 * (js/bad-tag-filter, js/incomplete-multi-character-sanitization).
 */
function removeTagBlocks(html: string, tagName: string): string {
  const lower = html.toLowerCase();
  const openTag = `<${tagName}`;
  const closeTag = `</${tagName}`;
  let result = "";
  let cursor = 0;

  while (cursor < html.length) {
    const openIdx = lower.indexOf(openTag, cursor);
    if (openIdx === -1) {
      result += html.slice(cursor);
      break;
    }
    const charAfterOpen = lower[openIdx + openTag.length];
    if (charAfterOpen !== undefined && charAfterOpen !== " " && charAfterOpen !== ">" && charAfterOpen !== "\t" && charAfterOpen !== "\n" && charAfterOpen !== "\r" && charAfterOpen !== "/") {
      result += html.slice(cursor, openIdx + openTag.length);
      cursor = openIdx + openTag.length;
      continue;
    }
    result += html.slice(cursor, openIdx);
    const closeIdx = lower.indexOf(closeTag, openIdx + openTag.length);
    if (closeIdx === -1) {
      break;
    }
    const endOfClose = html.indexOf(">", closeIdx + closeTag.length);
    cursor = endOfClose === -1 ? html.length : endOfClose + 1;
  }

  return result;
}

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

      const MAX_BODY_SIZE = 5 * 1024 * 1024; // 5MB

      // Read body with size limit
      const reader = res.body?.getReader();
      if (!reader) {
        return "Error: No response body";
      }

      const chunks: Uint8Array[] = [];
      let totalSize = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        totalSize += value.length;
        if (totalSize > MAX_BODY_SIZE) {
          reader.cancel();
          return "Error: Response exceeds 5MB size limit";
        }
        chunks.push(value);
      }

      const html = new TextDecoder().decode(
        chunks.length === 1 ? chunks[0] : Buffer.concat(chunks)
      );

      const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
      let content = bodyMatch ? bodyMatch[1] : html;

      // Remove script/style blocks using indexOf scanning — avoids regex
      // flagged by CodeQL (js/bad-tag-filter, js/incomplete-multi-character-sanitization)
      content = removeTagBlocks(content, "script");
      content = removeTagBlocks(content, "style");

      const text = content
        .replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;/g, " ")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&amp;/g, "&")
        .replace(/\s+/g, " ")
        .trim();

      return text.length > 10000 ? text.slice(0, 10000) + "... [Truncated]" : text;
    } catch (err) {
      return `Error reading webpage ${url}: ${(err as Error).message}`;
    }
  }
};
