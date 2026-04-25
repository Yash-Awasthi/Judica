/**
 * Whitelabel Routes
 *
 * Endpoints:
 *   GET    /:tenantId             — Get branding config (public)
 *   PUT    /:tenantId             — Upsert branding config (admin)
 *   DELETE /:tenantId             — Delete branding config (admin)
 *   GET    /domain/:domain        — Resolve branding by custom domain (public)
 */

import type { FastifyPluginAsync } from "fastify";
import { fastifyRequireAdmin } from "../middleware/fastifyAuth.js";
import {
  getBranding,
  upsertBranding,
  deleteBranding,
  resolveBrandingForDomain,
} from "../services/whitelabel.service.js";

const whitelabelPlugin: FastifyPluginAsync = async (fastify) => {
  // ─── Public: resolve by custom domain ───────────────────────────────────────

  fastify.get("/domain/:domain", {
    schema: {
      summary: 'Resolve branding by custom domain',
      tags: ['Whitelabel'],
      params: { type: 'object', properties: { domain: { type: 'string' } }, required: ['domain'] },
      response: {
        200: { type: 'object' },
        404: { type: 'object', properties: { error: { type: 'string' } } },
      },
    },
  }, async (request, reply) => {
    const { domain } = request.params as { domain: string };
    const branding = await resolveBrandingForDomain(domain);
    if (!branding) {
      reply.code(404);
      return { error: "No branding found for this domain" };
    }
    return branding;
  });

  // ─── Public: get branding by tenantId ───────────────────────────────────────

  fastify.get("/:tenantId", {
    schema: {
      summary: 'Get branding configuration for a tenant',
      tags: ['Whitelabel'],
      params: { type: 'object', properties: { tenantId: { type: 'string' } }, required: ['tenantId'] },
      response: {
        200: { type: 'object' },
        404: { type: 'object', properties: { error: { type: 'string' } } },
      },
    },
  }, async (request, reply) => {
    const { tenantId } = request.params as { tenantId: string };
    const branding = await getBranding(tenantId);
    if (!branding) {
      reply.code(404);
      return { error: "No branding found for this tenant" };
    }
    return branding;
  });

  // ─── Admin: upsert branding ──────────────────────────────────────────────────

  fastify.put("/:tenantId", {
    schema: {
      summary: 'Create or update branding configuration (admin)',
      tags: ['Whitelabel'],
      params: { type: 'object', properties: { tenantId: { type: 'string' } }, required: ['tenantId'] },
      body: {
        type: 'object',
        properties: {
          logoUrl: { type: 'string' },
          faviconUrl: { type: 'string' },
          primaryColor: { type: 'string' },
          appName: { type: 'string' },
          customCss: { type: 'string' },
        },
      },
      response: {
        200: { type: 'object' },
      },
    },
    preHandler: fastifyRequireAdmin,
  }, async (request) => {
    const { tenantId } = request.params as { tenantId: string };
    const body = request.body as Record<string, unknown>;
    return upsertBranding(tenantId, body as Parameters<typeof upsertBranding>[1]);
  });

  // ─── Admin: delete branding ──────────────────────────────────────────────────

  fastify.delete("/:tenantId", {
    schema: {
      summary: 'Delete branding configuration for a tenant (admin)',
      tags: ['Whitelabel'],
      params: { type: 'object', properties: { tenantId: { type: 'string' } }, required: ['tenantId'] },
      response: {
        204: { type: 'null', description: 'No content' },
        404: { type: 'object', properties: { error: { type: 'string' } } },
      },
    },
    preHandler: fastifyRequireAdmin,
  }, async (request, reply) => {
    const { tenantId } = request.params as { tenantId: string };
    const deleted = await deleteBranding(tenantId);
    if (!deleted) {
      reply.code(404);
      return { error: "No branding found for this tenant" };
    }
    reply.code(204);
  });
};

export default whitelabelPlugin;
