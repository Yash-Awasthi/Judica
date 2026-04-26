/**
 * Tenant Isolation Routes (admin only)
 *
 * Endpoints:
 *   POST   /api/tenant-isolation/:tenantId/keys          — provision key for tenant
 *   POST   /api/tenant-isolation/:tenantId/keys/rotate   — rotate tenant key
 *   GET    /api/tenant-isolation/:tenantId/keys/version  — get current key version
 *   DELETE /api/tenant-isolation/:tenantId/keys          — delete key (disable tenant isolation)
 */

import type { FastifyPluginAsync } from "fastify";
import { fastifyRequireAdmin } from "../middleware/fastifyAuth.js";
import {
  ensureTenantKey,
  rotateTenantKey,
} from "../services/tenantIsolation.service.js";
import { db } from "../lib/drizzle.js";
import { tenantEncryptionKeys } from "../db/schema/tenantIsolation.js";
import { eq } from "drizzle-orm";
import { AppError } from "../middleware/errorHandler.js";

const tenantIsolationPlugin: FastifyPluginAsync = async (fastify) => {
  fastify.addHook("preHandler", fastifyRequireAdmin);

  // ─── Provision ────────────────────────────────────────────────────────────

  fastify.post("/:tenantId/keys", {
    config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
    schema: {
      summary: "Provision a per-tenant encryption key (idempotent)",
      tags: ["Tenant Isolation"],
      params: { type: "object", properties: { tenantId: { type: "string" } }, required: ["tenantId"] },
      response: { 200: { type: "object", properties: { ok: { type: "boolean" } } } },
    },
  }, async (request, reply) => {
    const { tenantId } = request.params as { tenantId: string };
    await ensureTenantKey(tenantId);
    reply.status(200);
    return { ok: true };
  });

  // ─── Rotate ───────────────────────────────────────────────────────────────

  fastify.post("/:tenantId/keys/rotate", {
    schema: {
      summary: "Rotate the per-tenant encryption key",
      tags: ["Tenant Isolation"],
      params: { type: "object", properties: { tenantId: { type: "string" } }, required: ["tenantId"] },
      response: { 200: { type: "object", properties: { keyVersion: { type: "number" } } } },
    },
  }, async (request, reply) => {
    const { tenantId } = request.params as { tenantId: string };
    const newVersion = await rotateTenantKey(tenantId);
    reply.status(200);
    return { keyVersion: newVersion };
  });

  // ─── Get key version ──────────────────────────────────────────────────────

  fastify.get("/:tenantId/keys/version", {
    schema: {
      summary: "Get the current key version for a tenant",
      tags: ["Tenant Isolation"],
      params: { type: "object", properties: { tenantId: { type: "string" } }, required: ["tenantId"] },
    },
  }, async (request) => {
    const { tenantId } = request.params as { tenantId: string };
    const [row] = await db
      .select({ keyVersion: tenantEncryptionKeys.keyVersion, active: tenantEncryptionKeys.active, updatedAt: tenantEncryptionKeys.updatedAt })
      .from(tenantEncryptionKeys)
      .where(eq(tenantEncryptionKeys.tenantId, tenantId))
      .limit(1);
    if (!row) throw new AppError(404, `No encryption key found for tenant ${tenantId}`);
    return row;
  });

  // ─── Delete key ───────────────────────────────────────────────────────────

  fastify.delete("/:tenantId/keys", {
    schema: {
      summary: "Delete the per-tenant encryption key (reverts to platform master key)",
      tags: ["Tenant Isolation"],
      params: { type: "object", properties: { tenantId: { type: "string" } }, required: ["tenantId"] },
    },
  }, async (request, reply) => {
    const { tenantId } = request.params as { tenantId: string };
    await db.delete(tenantEncryptionKeys).where(eq(tenantEncryptionKeys.tenantId, tenantId));
    reply.status(204);
    return;
  });
};

export default tenantIsolationPlugin;
