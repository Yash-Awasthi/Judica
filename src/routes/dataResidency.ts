/**
 * Data Residency Routes
 *
 * Endpoints:
 *   GET    /api/data-residency/regions          — list supported regions (public)
 *   GET    /api/data-residency/:tenantId        — get residency config (admin)
 *   PUT    /api/data-residency/:tenantId        — upsert residency config (admin)
 *   DELETE /api/data-residency/:tenantId        — reset to defaults (admin)
 *   GET    /api/data-residency                  — list all configs (admin)
 */

import type { FastifyPluginAsync } from "fastify";
import { fastifyRequireAdmin } from "../middleware/fastifyAuth.js";
import {
  getResidencyConfig,
  upsertResidencyConfig,
  listResidencyConfigs,
} from "../services/dataResidency.service.js";
import { db } from "../lib/drizzle.js";
import { tenantDataResidency, SUPPORTED_REGIONS } from "../db/schema/dataResidency.js";
import { eq } from "drizzle-orm";
import { AppError } from "../middleware/errorHandler.js";

const dataResidencyPlugin: FastifyPluginAsync = async (fastify) => {
  // ─── Public: list supported regions ──────────────────────────────────────

  fastify.get("/regions", {
    schema: {
      summary: "List all supported data-residency regions",
      tags: ["Data Residency"],
      response: {
        200: {
          type: "object",
          properties: {
            regions: { type: "array", items: { type: "string" } },
            default: { type: "string" },
          },
        },
      },
    },
  }, async () => {
    return {
      regions: [...SUPPORTED_REGIONS],
      default: (process.env.DATA_DEFAULT_REGION as string | undefined) ?? "us-east-1",
    };
  });

  // ─── Admin: list all residency configs ────────────────────────────────────

  fastify.get("/", {
    schema: {
      summary: "List all tenant data-residency configs",
      tags: ["Data Residency"],
      response: { 200: { type: "object", properties: { configs: { type: "array", items: { type: "object" } } } } },
    },
    preHandler: fastifyRequireAdmin,
  }, async () => {
    return { configs: await listResidencyConfigs() };
  });

  // ─── Admin: get one tenant's config ──────────────────────────────────────

  fastify.get("/:tenantId", {
    schema: {
      summary: "Get data-residency config for a tenant",
      tags: ["Data Residency"],
      params: { type: "object", properties: { tenantId: { type: "string" } }, required: ["tenantId"] },
      response: { 200: { type: "object" } },
    },
    preHandler: fastifyRequireAdmin,
  }, async (request) => {
    const { tenantId } = request.params as { tenantId: string };
    return getResidencyConfig(tenantId);
  });

  // ─── Admin: upsert ───────────────────────────────────────────────────────

  fastify.put("/:tenantId", {
    schema: {
      summary: "Set or update data-residency config for a tenant",
      tags: ["Data Residency"],
      params: { type: "object", properties: { tenantId: { type: "string" } }, required: ["tenantId"] },
      body: {
        type: "object",
        properties: {
          primaryRegion: { type: "string" },
          secondaryRegions: { type: "array", items: { type: "string" } },
          vectorNamespace: { type: "string", nullable: true },
          storagePrefix: { type: "string", nullable: true },
          dbReadEndpoint: { type: "string", nullable: true },
          strictEnforcement: { type: "boolean" },
        },
      },
    },
    preHandler: fastifyRequireAdmin,
  }, async (request, reply) => {
    const { tenantId } = request.params as { tenantId: string };
    const body = request.body as {
      primaryRegion?: string;
      secondaryRegions?: string[];
      vectorNamespace?: string | null;
      storagePrefix?: string | null;
      dbReadEndpoint?: string | null;
      strictEnforcement?: boolean;
    };

    // Validate regions
    const supported = SUPPORTED_REGIONS as readonly string[];
    if (body.primaryRegion && !supported.includes(body.primaryRegion)) {
      throw new AppError(400, `Unsupported region: ${body.primaryRegion}. Supported: ${supported.join(", ")}`);
    }
    const badSecondary = (body.secondaryRegions ?? []).filter((r) => !supported.includes(r));
    if (badSecondary.length > 0) {
      throw new AppError(400, `Unsupported secondary regions: ${badSecondary.join(", ")}`);
    }

    const config = await upsertResidencyConfig(tenantId, body as Parameters<typeof upsertResidencyConfig>[1]);
    reply.status(200);
    return config;
  });

  // ─── Admin: reset to defaults ─────────────────────────────────────────────

  fastify.delete("/:tenantId", {
    schema: {
      summary: "Reset data-residency config for a tenant (removes override, falls back to default)",
      tags: ["Data Residency"],
      params: { type: "object", properties: { tenantId: { type: "string" } }, required: ["tenantId"] },
    },
    preHandler: fastifyRequireAdmin,
  }, async (request, reply) => {
    const { tenantId } = request.params as { tenantId: string };
    await db.delete(tenantDataResidency).where(eq(tenantDataResidency.tenantId, tenantId));
    reply.status(204);
    return;
  });
};

export default dataResidencyPlugin;
