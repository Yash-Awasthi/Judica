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

const patPlugin: FastifyPluginAsync = async (fastify) => {
  fastify.addHook("onRequest", fastifyRequireAuth);

  fastify.get("/", async (request) => {
    const tokens = await listPats(request.userId!);
    return { tokens };
  });

  fastify.post("/", async (request, reply) => {
    const body = request.body as { label?: string; scopes?: string[]; expiresInDays?: number };

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

    const result = await createPat(request.userId!, {
      label: body.label.trim(),
      scopes: body.scopes,
      expiresInDays: body.expiresInDays,
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
