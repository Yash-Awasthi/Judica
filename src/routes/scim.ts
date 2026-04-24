/**
 * SCIM 2.0 Routes — RFC 7644-compliant provisioning endpoints.
 *
 * Endpoints:
 *   GET    /Users          — List/filter users
 *   POST   /Users          — Create user
 *   GET    /Users/:id      — Get user
 *   PUT    /Users/:id      — Replace user
 *   PATCH  /Users/:id      — Patch user (active/inactive toggle)
 *   DELETE /Users/:id      — Deactivate user
 *   GET    /ServiceProviderConfig — SCIM capabilities
 *   GET    /Schemas        — Supported schemas
 *   GET    /ResourceTypes  — Supported resource types
 */

import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from "fastify";
import {
  scimCreateUser,
  scimGetUser,
  scimListUsers,
  scimUpdateUser,
  scimPatchUser,
  scimDeleteUser,
  scimError,
} from "../services/scim.service.js";
import type { ScimUser, ScimPatchOp } from "../services/scim.service.js";
import { db } from "../lib/drizzle.js";
import { scimTokens } from "../db/schema/scim.js";
import { eq, and } from "drizzle-orm";
import { timingSafeEqual, createHash } from "node:crypto";

// ─── SCIM Auth Middleware ────────────────────────────────────────────────────

async function authenticateScimToken(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const authHeader = request.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    reply.code(401).send(scimError(401, "Missing or invalid SCIM bearer token"));
    return;
  }

  const token = authHeader.slice(7);
  const tokenHash = createHash("sha256").update(token).digest("hex");

  const [record] = await db
    .select()
    .from(scimTokens)
    .where(and(eq(scimTokens.tokenHash, tokenHash), eq(scimTokens.active, true)))
    .limit(1);

  if (!record) {
    reply.code(401).send(scimError(401, "Invalid SCIM token"));
    return;
  }

  if (record.expiresAt && record.expiresAt < new Date()) {
    reply.code(401).send(scimError(401, "SCIM token expired"));
    return;
  }

  // Update last used timestamp (fire-and-forget)
  db.update(scimTokens)
    .set({ lastUsedAt: new Date() })
    .where(eq(scimTokens.id, record.id))
    .catch(() => {});
}

// ─── Plugin ──────────────────────────────────────────────────────────────────

const scimPlugin: FastifyPluginAsync = async (fastify) => {
  // All SCIM endpoints require bearer token auth
  fastify.addHook("onRequest", authenticateScimToken);

  // SCIM content type
  fastify.addHook("onSend", async (_request, reply) => {
    reply.header("Content-Type", "application/scim+json");
  });

  // ─── Users ───────────────────────────────────────────────────────────────

  fastify.get("/Users", async (request) => {
    const query = request.query as Record<string, string>;
    const startIndex = Number(query.startIndex) || 1;
    const count = Math.min(Number(query.count) || 100, 200);
    const filter = query.filter;
    return scimListUsers(startIndex, count, filter);
  });

  fastify.post("/Users", async (request, reply) => {
    const scimUser = request.body as ScimUser;
    if (!scimUser.userName && !scimUser.emails?.length) {
      reply.code(400);
      return scimError(400, "userName or emails is required");
    }
    const created = await scimCreateUser(scimUser);
    reply.code(201);
    return created;
  });

  fastify.get("/Users/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const user = await scimGetUser(Number(id));
    if (!user) {
      reply.code(404);
      return scimError(404, `User ${id} not found`);
    }
    return user;
  });

  fastify.put("/Users/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const scimUser = request.body as ScimUser;
    try {
      return await scimUpdateUser(Number(id), scimUser);
    } catch {
      reply.code(404);
      return scimError(404, `User ${id} not found`);
    }
  });

  fastify.patch("/Users/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const patchOp = request.body as ScimPatchOp;
    try {
      return await scimPatchUser(Number(id), patchOp);
    } catch {
      reply.code(404);
      return scimError(404, `User ${id} not found`);
    }
  });

  fastify.delete("/Users/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    await scimDeleteUser(Number(id));
    reply.code(204);
  });

  // ─── Service Provider Config ─────────────────────────────────────────────

  fastify.get("/ServiceProviderConfig", async () => ({
    schemas: ["urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig"],
    documentationUri: "https://github.com/Yash-Awasthi/aibyai",
    patch: { supported: true },
    bulk: { supported: false, maxOperations: 0, maxPayloadSize: 0 },
    filter: { supported: true, maxResults: 200 },
    changePassword: { supported: false },
    sort: { supported: false },
    etag: { supported: false },
    authenticationSchemes: [{
      type: "oauthbearertoken",
      name: "OAuth Bearer Token",
      description: "Authentication scheme using the OAuth Bearer Token standard",
    }],
  }));

  // ─── Schemas ─────────────────────────────────────────────────────────────

  fastify.get("/Schemas", async () => ({
    schemas: ["urn:ietf:params:scim:api:messages:2.0:ListResponse"],
    totalResults: 1,
    Resources: [{
      id: "urn:ietf:params:scim:schemas:core:2.0:User",
      name: "User",
      description: "SCIM User resource",
    }],
  }));

  // ─── Resource Types ──────────────────────────────────────────────────────

  fastify.get("/ResourceTypes", async () => ({
    schemas: ["urn:ietf:params:scim:api:messages:2.0:ListResponse"],
    totalResults: 1,
    Resources: [{
      schemas: ["urn:ietf:params:scim:schemas:core:2.0:ResourceType"],
      id: "User",
      name: "User",
      endpoint: "/Users",
      schema: "urn:ietf:params:scim:schemas:core:2.0:User",
    }],
  }));
};

export default scimPlugin;
