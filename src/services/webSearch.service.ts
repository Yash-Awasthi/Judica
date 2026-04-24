/**
 * Web Search Service — multi-provider web search abstraction.
 *
 * Supports: Tavily, SerpAPI, Serper, Brave Search, Google PSE, SearXNG.
 * Provider resolution: env-configured preferred provider → fallback chain.
 */

import { env } from "../config/env.js";
import logger from "../lib/logger.js";

/* ── Types ─────────────────────────────────────────────────────────── */

export interface SearchResult {
  title: string;
  url: string;
  content: string;
  score?: number;
}

export interface SearchOptions {
  query: string;
  maxResults?: number;
  depth?: "basic" | "advanced";
  provider?: SearchProvider;
}

export type SearchProvider = "tavily" | "serpapi" | "serper" | "brave" | "google_pse" | "searxng";

interface ProviderImpl {
  name: SearchProvider;
  available: () => boolean;
  search: (query: string, maxResults: number, depth: string) => Promise<SearchResult[]>;
}

/* ── Provider Implementations ──────────────────────────────────────── */

const tavilyProvider: ProviderImpl = {
  name: "tavily",
  available: () => !!env.TAVILY_API_KEY,
  search: async (query, maxResults, depth) => {
    const resp = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: env.TAVILY_API_KEY,
        query,
        search_depth: depth,
        max_results: maxResults,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!resp.ok) throw new Error(`Tavily error: ${resp.status}`);
    const data = (await resp.json()) as { results?: Array<{ title: string; url: string; content: string; score?: number }> };
    return (data.results || []).map(r => ({
      title: r.title,
      url: r.url,
      content: r.content,
      score: r.score,
    }));
  },
};

const serpapiProvider: ProviderImpl = {
  name: "serpapi",
  available: () => !!env.SERP_API_KEY,
  search: async (query, maxResults) => {
    const params = new URLSearchParams({
      engine: "google",
      q: query,
      num: String(maxResults),
      api_key: env.SERP_API_KEY!,
    });
    const resp = await fetch(`https://serpapi.com/search.json?${params}`, {
      signal: AbortSignal.timeout(10_000),
    });
    if (!resp.ok) throw new Error(`SerpAPI error: ${resp.status}`);
    const data = (await resp.json()) as { organic_results?: Array<{ title: string; link: string; snippet: string }> };
    return (data.organic_results || []).slice(0, maxResults).map(r => ({
      title: r.title,
      url: r.link,
      content: r.snippet,
    }));
  },
};

const serperProvider: ProviderImpl = {
  name: "serper",
  available: () => !!env.SERPER_API_KEY,
  search: async (query, maxResults) => {
    const resp = await fetch("https://google.serper.dev/search", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-KEY": env.SERPER_API_KEY!,
      },
      body: JSON.stringify({ q: query, num: maxResults }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!resp.ok) throw new Error(`Serper error: ${resp.status}`);
    const data = (await resp.json()) as { organic?: Array<{ title: string; link: string; snippet: string }> };
    return (data.organic || []).slice(0, maxResults).map(r => ({
      title: r.title,
      url: r.link,
      content: r.snippet,
    }));
  },
};

const braveProvider: ProviderImpl = {
  name: "brave",
  available: () => !!env.BRAVE_SEARCH_API_KEY,
  search: async (query, maxResults) => {
    const params = new URLSearchParams({
      q: query,
      count: String(maxResults),
    });
    const resp = await fetch(`https://api.search.brave.com/res/v1/web/search?${params}`, {
      headers: {
        Accept: "application/json",
        "Accept-Encoding": "gzip",
        "X-Subscription-Token": env.BRAVE_SEARCH_API_KEY!,
      },
      signal: AbortSignal.timeout(10_000),
    });
    if (!resp.ok) throw new Error(`Brave Search error: ${resp.status}`);
    const data = (await resp.json()) as { web?: { results?: Array<{ title: string; url: string; description: string }> } };
    return (data.web?.results || []).slice(0, maxResults).map(r => ({
      title: r.title,
      url: r.url,
      content: r.description,
    }));
  },
};

const googlePseProvider: ProviderImpl = {
  name: "google_pse",
  available: () => !!env.GOOGLE_PSE_API_KEY && !!env.GOOGLE_PSE_CX,
  search: async (query, maxResults) => {
    const params = new URLSearchParams({
      key: env.GOOGLE_PSE_API_KEY!,
      cx: env.GOOGLE_PSE_CX!,
      q: query,
      num: String(Math.min(maxResults, 10)), // Google PSE max is 10
    });
    const resp = await fetch(`https://www.googleapis.com/customsearch/v1?${params}`, {
      signal: AbortSignal.timeout(10_000),
    });
    if (!resp.ok) throw new Error(`Google PSE error: ${resp.status}`);
    const data = (await resp.json()) as { items?: Array<{ title: string; link: string; snippet: string }> };
    return (data.items || []).slice(0, maxResults).map(r => ({
      title: r.title,
      url: r.link,
      content: r.snippet,
    }));
  },
};

const searxngProvider: ProviderImpl = {
  name: "searxng",
  available: () => !!env.SEARXNG_BASE_URL,
  search: async (query, maxResults) => {
    const baseUrl = env.SEARXNG_BASE_URL!.replace(/\/+$/, "");
    const params = new URLSearchParams({
      q: query,
      format: "json",
      pageno: "1",
    });
    const resp = await fetch(`${baseUrl}/search?${params}`, {
      signal: AbortSignal.timeout(10_000),
    });
    if (!resp.ok) throw new Error(`SearXNG error: ${resp.status}`);
    const data = (await resp.json()) as { results?: Array<{ title: string; url: string; content: string; score?: number }> };
    return (data.results || []).slice(0, maxResults).map(r => ({
      title: r.title,
      url: r.url,
      content: r.content,
      score: r.score,
    }));
  },
};

/* ── Provider Registry ─────────────────────────────────────────────── */

const ALL_PROVIDERS: ProviderImpl[] = [
  tavilyProvider,
  serperProvider,
  braveProvider,
  googlePseProvider,
  serpapiProvider,
  searxngProvider,
];

/**
 * Get all configured (available) search providers.
 */
export function listAvailableSearchProviders(): SearchProvider[] {
  return ALL_PROVIDERS.filter(p => p.available()).map(p => p.name);
}

/**
 * Resolve which provider to use based on explicit choice or fallback chain.
 */
function resolveProvider(preferred?: SearchProvider): ProviderImpl | null {
  if (preferred) {
    const match = ALL_PROVIDERS.find(p => p.name === preferred);
    if (match?.available()) return match;
    logger.warn(`Preferred search provider '${preferred}' not available, falling back`);
  }

  // Check env-configured preferred provider
  const envPreferred = process.env.WEB_SEARCH_PROVIDER as SearchProvider | undefined;
  if (envPreferred) {
    const match = ALL_PROVIDERS.find(p => p.name === envPreferred);
    if (match?.available()) return match;
  }

  // Fallback chain: first available wins
  return ALL_PROVIDERS.find(p => p.available()) || null;
}

/* ── Public API ────────────────────────────────────────────────────── */

/**
 * Execute a web search using the best available provider.
 */
export async function webSearch(options: SearchOptions): Promise<SearchResult[]> {
  const { query, maxResults = 5, depth = "basic", provider: preferred } = options;

  const provider = resolveProvider(preferred);
  if (!provider) {
    logger.warn("No web search provider configured");
    return [];
  }

  try {
    const results = await provider.search(query, maxResults, depth);
    logger.info({ provider: provider.name, query, resultCount: results.length }, "Web search completed");
    return deduplicateResults(results);
  } catch (err) {
    logger.warn({ provider: provider.name, error: (err as Error).message }, "Search provider failed, trying fallback");

    // Try next available provider
    for (const fallback of ALL_PROVIDERS) {
      if (fallback.name === provider.name || !fallback.available()) continue;
      try {
        const results = await fallback.search(query, maxResults, depth);
        logger.info({ provider: fallback.name, query, resultCount: results.length }, "Fallback search completed");
        return deduplicateResults(results);
      } catch (fallbackErr) {
        logger.warn({ provider: fallback.name, error: (fallbackErr as Error).message }, "Fallback search also failed");
      }
    }

    return [];
  }
}

/**
 * Deduplicate results by URL.
 */
function deduplicateResults(results: SearchResult[]): SearchResult[] {
  const seen = new Set<string>();
  return results.filter(r => {
    const key = r.url.toLowerCase().replace(/\/+$/, "");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
