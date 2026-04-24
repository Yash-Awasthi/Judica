/**
 * Web Search Routes — provider management and direct search API.
 *
 * GET  /providers  — list available search providers
 * POST /           — execute a web search
 */

import { type FastifyInstance, type FastifyRequest, type FastifyReply } from "fastify";
import { fastifyRequireAuth } from "../middleware/fastifyAuth.js";
import {
  webSearch,
  listAvailableSearchProviders,
  type SearchProvider,
} from "../services/webSearch.service.js";

export default async function webSearchPlugin(fastify: FastifyInstance): Promise<void> {

  /**
   * GET /providers — list configured search providers.
   */
  fastify.get("/providers", {
    preHandler: [fastifyRequireAuth],
    schema: {
      description: "List available web search providers",
      tags: ["Web Search"],
      response: {
        200: {
          type: "object",
          properties: {
            providers: { type: "array", items: { type: "string" } },
            preferred: { type: "string", nullable: true },
          },
        },
      },
    },
  }, async (_request: FastifyRequest, reply: FastifyReply) => {
    const providers = listAvailableSearchProviders();
    reply.send({
      providers,
      preferred: process.env.WEB_SEARCH_PROVIDER || null,
    });
  });

  /**
   * POST / — execute a web search.
   */
  fastify.post("/", {
    preHandler: [fastifyRequireAuth],
    schema: {
      description: "Execute a web search using the best available provider",
      tags: ["Web Search"],
      body: {
        type: "object",
        required: ["query"],
        properties: {
          query: { type: "string", minLength: 1, maxLength: 500 },
          maxResults: { type: "number", minimum: 1, maximum: 20, default: 5 },
          depth: { type: "string", enum: ["basic", "advanced"], default: "basic" },
          provider: { type: "string", enum: ["tavily", "serpapi", "serper", "brave", "google_pse", "searxng"] },
        },
      },
      response: {
        200: {
          type: "object",
          properties: {
            results: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  title: { type: "string" },
                  url: { type: "string" },
                  content: { type: "string" },
                  score: { type: "number", nullable: true },
                },
              },
            },
            provider: { type: "string" },
          },
        },
      },
    },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { query, maxResults, depth, provider } = request.body as {
      query: string;
      maxResults?: number;
      depth?: "basic" | "advanced";
      provider?: SearchProvider;
    };

    const results = await webSearch({ query, maxResults, depth, provider });
    const available = listAvailableSearchProviders();

    reply.send({
      results,
      provider: provider || process.env.WEB_SEARCH_PROVIDER || available[0] || "none",
    });
  });
}
