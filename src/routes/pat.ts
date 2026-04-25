/**
 * Personal Access Token Routes — CRUD endpoints for API key management.
 *
 * Endpoints:
 *   GET    /              — List user's tokens (metadata only, no secrets)
 *   POST   /              — Create new token (returns plaintext once)
 *   DELETE /:id           — Revoke a token
 */

import type { FastifyPluginAsync } from "fastify";
import { fastifyRequireAuth } from "../middleware/fastifyAuth.js";
import { createPat, listPats, revokePat, validateScopes } from "../services/pat.service.js";
import type { PatTier } from "../services/pat.service.js";

const VALID_TIERS = new Set<PatTier>(["admin", "basic", "limited"]);

const patPlugin: FastifyPluginAsync = async (fastify) => {
  fastify.addHook("onRequest", fastifyRequireAuth);

  fastify.get("/", async (request) => {
    const tokens = await listPats(request.userId!);
    return { tokens };
  });

  fastify.post("/", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (request, reply) => {
    const body = request.body as {
      label?: string;
      scopes?: string[];
      expiresInDays?: number;
      tier?: string;
      allowedRoutes?: string[];
    };

    if (!body.label || typeof body.label !== "string" || body.label.trim().length === 0) {
      reply.code(400);
      return { error: "label is required" };
    }

    if (body.label.length > 100) {
      reply.code(400);
      return { error: "label must be 100 characters or fewer" };
    }

    if (body.scopes) {
      const { valid, invalid } = validateScopes(body.scopes);
      if (!valid) {
        reply.code(400);
        return { error: `Invalid scopes: ${invalid.join(", ")}` };
      }
    }

    if (body.expiresInDays !== undefined) {
      if (!Number.isInteger(body.expiresInDays) || body.expiresInDays < 1 || body.expiresInDays > 365) {
        reply.code(400);
        return { error: "expiresInDays must be between 1 and 365" };
      }
    }

    // Tier validation
    let tier: PatTier = "basic";
    if (body.tier !== undefined) {
      if (!VALID_TIERS.has(body.tier as PatTier)) {
        reply.code(400);
        return { error: `Invalid tier '${body.tier}'. Valid tiers: admin, basic, limited` };
      }
      tier = body.tier as PatTier;

      // Only admin/owner accounts can create admin-tier keys
      if (tier === "admin" && request.role !== "admin" && request.role !== "owner") {
        reply.code(403);
        return { error: "Only admin users can create admin-tier API keys" };
      }
    }

    // allowedRoutes must be an array of strings if provided
    if (body.allowedRoutes !== undefined) {
      if (!Array.isArray(body.allowedRoutes) || body.allowedRoutes.some((r) => typeof r !== "string")) {
        reply.code(400);
        return { error: "allowedRoutes must be an array of strings" };
      }
      if (body.allowedRoutes.length > 50) {
        reply.code(400);
        return { error: "allowedRoutes must contain 50 entries or fewer" };
      }
    }

    const result = await createPat(request.userId!, {
      label: body.label.trim(),
      scopes: body.scopes,
      expiresInDays: body.expiresInDays,
      tier,
      allowedRoutes: body.allowedRoutes,
    });

    reply.code(201);
    return result;
  });

  fastify.delete("/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const patId = Number(id);

    if (!Number.isInteger(patId) || patId < 1) {
      reply.code(400);
      return { error: "Invalid token ID" };
    }

    const revoked = await revokePat(request.userId!, patId);
    if (!revoked) {
      reply.code(404);
      return { error: "Token not found" };
    }

    reply.code(204);
  });
};

export default patPlugin;
