/**
 * Onboarding Wizard Routes
 *
 * Endpoints:
 *   GET    /api/onboarding              — get current user's wizard state
 *   GET    /api/onboarding/summary      — get progress summary (for wizard UI)
 *   POST   /api/onboarding/steps/:step  — mark a step as completed
 *   POST   /api/onboarding/skip         — skip the wizard permanently
 *   DELETE /api/onboarding              — reset wizard (admin)
 */

import type { FastifyPluginAsync } from "fastify";
import { fastifyRequireAuth, fastifyRequireAdmin } from "../middleware/fastifyAuth.js";
import {
  getOrCreateState,
  completeStep,
  skipOnboarding,
  resetOnboarding,
  getOnboardingSummary,
} from "../services/onboarding.service.js";
import { ONBOARDING_STEPS } from "../db/schema/onboarding.js";
import type { OnboardingStep } from "../db/schema/onboarding.js";
import { AppError } from "../middleware/errorHandler.js";
import type { FastifyRequest } from "fastify";

/** Extract numeric user ID from authenticated request. */
function getUserId(request: FastifyRequest): number {
  const u = (request as unknown as { user?: { id?: number } }).user;
  if (!u?.id) throw new AppError(401, "Not authenticated");
  return u.id;
}

const onboardingPlugin: FastifyPluginAsync = async (fastify) => {
  // ─── GET state ────────────────────────────────────────────────────────────

  fastify.get("/", {
    schema: {
      summary: "Get the authenticated user's onboarding wizard state",
      tags: ["Onboarding"],
      response: { 200: { type: "object" } },
    },
    preHandler: fastifyRequireAuth,
  }, async (request) => {
    return getOrCreateState(getUserId(request));
  });

  // ─── GET summary ──────────────────────────────────────────────────────────

  fastify.get("/summary", {
    schema: {
      summary: "Get onboarding progress summary for the wizard UI",
      tags: ["Onboarding"],
      response: { 200: { type: "object" } },
    },
    preHandler: fastifyRequireAuth,
  }, async (request) => {
    return getOnboardingSummary(getUserId(request));
  });

  // ─── GET steps list ───────────────────────────────────────────────────────

  fastify.get("/steps", {
    schema: {
      summary: "List all available onboarding steps",
      tags: ["Onboarding"],
      response: {
        200: {
          type: "object",
          properties: { steps: { type: "array", items: { type: "string" } } },
        },
      },
    },
  }, async () => {
    return { steps: [...ONBOARDING_STEPS] };
  });

  // ─── POST complete step ───────────────────────────────────────────────────

  fastify.post("/steps/:step", {
    schema: {
      summary: "Mark an onboarding step as completed",
      tags: ["Onboarding"],
      params: { type: "object", properties: { step: { type: "string" } }, required: ["step"] },
      body: {
        type: "object",
        additionalProperties: true,
        description: "Optional step-specific metadata stored alongside the step",
      },
    },
    preHandler: fastifyRequireAuth,
  }, async (request, reply) => {
    const { step } = request.params as { step: string };
    const body = (request.body ?? {}) as Record<string, unknown>;

    if (!(ONBOARDING_STEPS as readonly string[]).includes(step)) {
      throw new AppError(400, `Unknown onboarding step: ${step}. Valid steps: ${ONBOARDING_STEPS.join(", ")}`);
    }

    const updated = await completeStep(getUserId(request), step as OnboardingStep, Object.keys(body).length ? body : undefined);
    reply.status(200);
    return updated;
  });

  // ─── POST skip ────────────────────────────────────────────────────────────

  fastify.post("/skip", {
    schema: {
      summary: "Skip (permanently dismiss) the onboarding wizard",
      tags: ["Onboarding"],
      response: { 200: { type: "object" } },
    },
    preHandler: fastifyRequireAuth,
  }, async (request, reply) => {
    const updated = await skipOnboarding(getUserId(request));
    reply.status(200);
    return updated;
  });

  // ─── DELETE reset (admin) ──────────────────────────────────────────────────

  fastify.delete("/:userId", {
    schema: {
      summary: "Reset onboarding state for a user (admin only)",
      tags: ["Onboarding"],
      params: { type: "object", properties: { userId: { type: "string" } }, required: ["userId"] },
    },
    preHandler: fastifyRequireAdmin,
  }, async (request, reply) => {
    const rawId = (request.params as { userId: string }).userId;
    const userId = parseInt(rawId, 10);
    if (isNaN(userId)) throw new AppError(400, "Invalid userId");
    await resetOnboarding(userId);
    reply.status(204);
    return;
  });
};

export default onboardingPlugin;
