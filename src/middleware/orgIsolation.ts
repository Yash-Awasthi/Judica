import { FastifyRequest, FastifyReply } from "fastify";
import logger from "../lib/logger.js";

/**
 * P4-06: Multi-tenant / organization isolation middleware.
 *
 * Architecture:
 * - Each user belongs to an org (default: personal org = user's own ID).
 * - All data queries MUST be scoped by orgId to prevent cross-tenant access.
 * - The orgId is derived from the authenticated user's token/session.
 *
 * Current state: This is a stub that extracts orgId from the request context.
 * To fully enable org isolation, a schema migration is required to add orgId
 * to all tenant-scoped tables (conversations, chats, uploads, kb, etc.)
 * and all queries must include WHERE orgId = ? conditions.
 *
 * Migration path:
 * 1. Add `orgId` column to: conversations, chats, uploads, kb_items,
 *    usage_logs, workflow_runs, artifacts, memory_backends, traces
 * 2. Create orgs table with: id, name, ownerId, plan, createdAt
 * 3. Add orgId to users table (default: self-org for backwards compat)
 * 4. Update all service queries to scope by orgId
 * 5. Enforce this middleware on all /api/* routes
 */

// Extend FastifyRequest to include orgId
declare module "fastify" {
  interface FastifyRequest {
    orgId?: number;
  }
}

/**
 * Extracts orgId from the authenticated user's context.
 * Falls through if no orgId is available (backwards compatible).
 */
export async function fastifyOrgIsolation(request: FastifyRequest, _reply: FastifyReply) {
  // Once org tables exist, resolve orgId from the user's membership:
  // const user = await getUserOrg(request.userId);
  // request.orgId = user.orgId;

  // For now, use userId as a pseudo-orgId (per-user isolation = current behavior)
  if (request.userId) {
    request.orgId = request.userId;
  }
}

/**
 * Require orgId — use as preHandler on routes that must be org-scoped.
 * Returns 403 if no org context is available.
 */
export async function fastifyRequireOrg(request: FastifyRequest, reply: FastifyReply) {
  if (!request.orgId) {
    logger.warn({ userId: request.userId, url: request.url }, "Request without org context");
    reply.code(403).send({ error: "Organization context required" });
    return;
  }
}
