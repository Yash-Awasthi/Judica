/**
 * Billing Routes
 *
 * Endpoints:
 *   GET    /plans                    — List all active plans (public)
 *   GET    /subscription/:tenantId   — Get current subscription (auth)
 *   POST   /checkout                 — Create Stripe checkout session (auth)
 *   POST   /cancel/:tenantId         — Cancel subscription (admin)
 *   POST   /webhook                  — Stripe webhook handler (no auth, sig verified)
 *   GET    /usage/:tenantId          — Get usage stats (auth)
 */

import type { FastifyPluginAsync } from "fastify";
import { fastifyRequireAuth, fastifyRequireAdmin } from "../middleware/fastifyAuth.js";
import {
  getPlans,
  getSubscription,
  createCheckoutSession,
  cancelSubscription,
  handleStripeWebhook,
  getUsageSummary,
} from "../services/billing.service.js";

const billingPlugin: FastifyPluginAsync = async (fastify) => {
  // ─── Public: list plans ──────────────────────────────────────────────────────

  fastify.get("/plans", {
    schema: {
      summary: 'List all active billing plans',
      tags: ['Billing'],
      response: {
        200: {
          type: 'object',
          properties: {
            plans: { type: 'array', items: { type: 'object' } },
          },
        },
      },
    },
  }, async () => {
    return { plans: await getPlans() };
  });

  // ─── Auth: get subscription ──────────────────────────────────────────────────

  fastify.get("/subscription/:tenantId", {
    schema: {
      summary: 'Get current subscription for a tenant',
      tags: ['Billing'],
      params: { type: 'object', properties: { tenantId: { type: 'string' } }, required: ['tenantId'] },
      response: {
        200: { type: 'object' },
        404: { type: 'object', properties: { error: { type: 'string' } } },
      },
    },
    preHandler: fastifyRequireAuth,
  }, async (request, reply) => {
    const { tenantId } = request.params as { tenantId: string };
    const subscription = await getSubscription(tenantId);
    if (!subscription) {
      reply.code(404);
      return { error: "No subscription found for this tenant" };
    }
    return subscription;
  });

  // ─── Auth: create checkout session ───────────────────────────────────────────

  fastify.post("/checkout", {
    schema: {
      summary: 'Create a Stripe checkout session',
      tags: ['Billing'],
      body: {
        type: 'object',
        required: ['tenantId', 'planId'],
        properties: {
          tenantId: { type: 'string' },
          planId: { type: 'string' },
          interval: { type: 'string', enum: ['monthly', 'annual'], description: 'Billing interval (default monthly)' },
        },
      },
      response: {
        200: { type: 'object', properties: { url: { type: 'string', nullable: true } } },
        400: { type: 'object', properties: { error: { type: 'string' } } },
        503: { type: 'object', properties: { error: { type: 'string' } } },
      },
    },
    preHandler: fastifyRequireAuth,
  }, async (request, reply) => {
    const body = request.body as { tenantId?: string; planId?: string; interval?: string };
    if (!body.tenantId || !body.planId) {
      reply.code(400);
      return { error: "tenantId and planId are required" };
    }
    const interval = body.interval === "annual" ? "annual" : "monthly";
    const result = await createCheckoutSession(body.tenantId, body.planId, interval);
    if (result.disabled) {
      reply.code(503);
      return { error: "Billing is not configured on this instance" };
    }
    return { url: result.url };
  });

  // ─── Admin: cancel subscription ──────────────────────────────────────────────

  fastify.post("/cancel/:tenantId", {
    schema: {
      summary: 'Cancel subscription for a tenant (admin)',
      tags: ['Billing'],
      params: { type: 'object', properties: { tenantId: { type: 'string' } }, required: ['tenantId'] },
      response: {
        200: { type: 'object', properties: { ok: { type: 'boolean' } } },
        404: { type: 'object', properties: { error: { type: 'string' } } },
      },
    },
    preHandler: fastifyRequireAdmin,
  }, async (request, reply) => {
    const { tenantId } = request.params as { tenantId: string };
    const cancelled = await cancelSubscription(tenantId);
    if (!cancelled) {
      reply.code(404);
      return { error: "No subscription found for this tenant" };
    }
    return { ok: true };
  });

  // ─── Public: Stripe webhook (signature verified inside service) ───────────────

  fastify.post("/webhook", {
    config: { rawBody: true },
  }, async (request, reply) => {
    const signature = request.headers["stripe-signature"];
    if (!signature || typeof signature !== "string") {
      reply.code(400);
      return { error: "Missing stripe-signature header" };
    }

    try {
      const payload = (request as unknown as { rawBody?: Buffer }).rawBody ?? Buffer.from(JSON.stringify(request.body));
      await handleStripeWebhook(payload, signature);
      return { received: true };
    } catch (err) {
      reply.code(400);
      return { error: (err as Error).message };
    }
  });

  // ─── Auth: usage summary ─────────────────────────────────────────────────────

  fastify.get("/usage/:tenantId", {
    schema: {
      summary: 'Get usage statistics for a tenant',
      tags: ['Billing'],
      params: { type: 'object', properties: { tenantId: { type: 'string' } }, required: ['tenantId'] },
      response: {
        200: { type: 'object' },
      },
    },
    preHandler: fastifyRequireAuth,
  }, async (request) => {
    const { tenantId } = request.params as { tenantId: string };
    return getUsageSummary(tenantId);
  });
};

export default billingPlugin;
