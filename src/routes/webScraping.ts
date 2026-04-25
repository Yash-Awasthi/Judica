/**
 * Web Scraping Routes — Firecrawl + Exa integration.
 *
 * POST /scrape       — scrape a single URL
 * POST /crawl        — crawl a website (multiple pages)
 * POST /exa/search   — Exa semantic search
 * POST /exa/contents — Exa content extraction
 * GET  /providers    — list available scraping providers
 */

import { type FastifyInstance, type FastifyRequest, type FastifyReply } from "fastify";
import { fastifyRequireAuth } from "../middleware/fastifyAuth.js";
import {
  scrapeUrl,
  firecrawlCrawl,
  exaSearch,
  exaGetContents,
  listAvailableScrapingProviders,
} from "../services/webScraping.service.js";

export default async function webScrapingPlugin(fastify: FastifyInstance): Promise<void> {

  fastify.get("/providers", {
    preHandler: [fastifyRequireAuth],
    schema: {
      description: "List available web scraping/extraction providers",
      tags: ["Web Scraping"],
    },
  }, async (_request: FastifyRequest, reply: FastifyReply) => {
    reply.send({ providers: listAvailableScrapingProviders() });
  });

  fastify.post("/scrape", {
    preHandler: [fastifyRequireAuth],
    schema: {
      description: "Scrape a single URL and extract content (uses Firecrawl if available, native fallback)",
      tags: ["Web Scraping"],
      body: {
        type: "object",
        required: ["url"],
        properties: {
          url: { type: "string", format: "uri" },
        },
      },
    },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { url } = request.body as { url: string };
    const result = await scrapeUrl(url);
    reply.send(result);
  });

  fastify.post("/crawl", {
    preHandler: [fastifyRequireAuth],
    schema: {
      description: "Crawl a website and extract content from multiple pages (Firecrawl required)",
      tags: ["Web Scraping"],
      body: {
        type: "object",
        required: ["url"],
        properties: {
          url: { type: "string", format: "uri" },
          maxPages: { type: "number", minimum: 1, maximum: 100, default: 10 },
          maxDepth: { type: "number", minimum: 1, maximum: 5, default: 2 },
        },
      },
    },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { url, maxPages, maxDepth } = request.body as {
      url: string;
      maxPages?: number;
      maxDepth?: number;
    };
    const results = await firecrawlCrawl({ url, maxPages, maxDepth });
    reply.send({ pages: results, count: results.length });
  });

  fastify.post("/exa/search", {
    preHandler: [fastifyRequireAuth],
    schema: {
      description: "Semantic search using Exa AI",
      tags: ["Web Scraping"],
      body: {
        type: "object",
        required: ["query"],
        properties: {
          query: { type: "string", minLength: 1, maxLength: 1000 },
          numResults: { type: "number", minimum: 1, maximum: 50, default: 10 },
          type: { type: "string", enum: ["keyword", "neural", "auto"], default: "auto" },
          useAutoprompt: { type: "boolean", default: true },
          includeContent: { type: "boolean", default: false },
          startDate: { type: "string", description: "ISO date string" },
          endDate: { type: "string", description: "ISO date string" },
        },
      },
    },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const options = request.body as {
      query: string;
      numResults?: number;
      type?: "keyword" | "neural" | "auto";
      useAutoprompt?: boolean;
      includeContent?: boolean;
      startDate?: string;
      endDate?: string;
    };
    const results = await exaSearch(options);
    reply.send({ results, count: results.length });
  });

  fastify.post("/exa/contents", {
    preHandler: [fastifyRequireAuth],
    schema: {
      description: "Extract content from specific URLs using Exa AI",
      tags: ["Web Scraping"],
      body: {
        type: "object",
        required: ["urls"],
        properties: {
          urls: { type: "array", items: { type: "string", format: "uri" }, minItems: 1, maxItems: 20 },
        },
      },
    },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { urls } = request.body as { urls: string[] };
    const results = await exaGetContents(urls);
    reply.send({ results, count: results.length });
  });
}
