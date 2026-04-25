/**
 * Federated Search Routes — query live external systems at search time
 *
 * Routes:
 *   POST /search       — query all enabled federated connectors
 *   GET  /connectors   — list available connector types
 */

import type { FastifyPluginAsync } from "fastify";
import { fastifyRequireAuth } from "../middleware/fastifyAuth.js";
import {
  queryFederatedConnectors,
  getAvailableFederatedConnectors,
} from "../services/federatedConnectors.service.js";

const federatedSearchPlugin: FastifyPluginAsync = async (fastify) => {
  // ── Search across federated connectors ──
  fastify.post("/search", {
    preHandler: [fastifyRequireAuth],
    schema: {
      summary: "Query live external systems (Slack, Confluence, GitHub, Notion, Jira)",
      tags: ["Federated Search"],
      body: {
        type: "object",
        required: ["query"],
        properties: {
          query: { type: "string", minLength: 1, maxLength: 1000 },
          sources: {
            type: "array",
            items: { type: "string" },
            description: "Filter to specific connector types (e.g. ['slack', 'github'])",
          },
          limit: { type: "number", minimum: 1, maximum: 50, default: 5 },
          timeoutMs: { type: "number", minimum: 1000, maximum: 30000, default: 8000 },
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
                  id: { type: "string" },
                  title: { type: "string" },
                  content: { type: "string" },
                  url: { type: ["string", "null"] },
                  source: { type: "string" },
                  score: { type: "number" },
                  timestamp: { type: ["string", "null"] },
                },
              },
            },
            count: { type: "number" },
          },
        },
      },
    },
  }, async (request) => {
    const userId = (request as unknown as { userId?: number }).userId;
    if (!userId) {
      throw new Error("Authentication required");
    }

    const { query, sources, limit, timeoutMs } = request.body as {
      query: string;
      sources?: string[];
      limit?: number;
      timeoutMs?: number;
    };

    const results = await queryFederatedConnectors(userId, query, {
      limit,
      sources,
      timeoutMs,
    });

    return { results, count: results.length };
  });

  // ── List available connector types ──
  fastify.get("/connectors", {
    preHandler: [fastifyRequireAuth],
    schema: {
      summary: "List available federated connector types",
      tags: ["Federated Search"],
      response: {
        200: {
          type: "object",
          properties: {
            connectors: {
              type: "array",
              items: { type: "string" },
            },
          },
        },
      },
    },
  }, async () => {
    return { connectors: getAvailableFederatedConnectors() };
  });
};

export default federatedSearchPlugin;
