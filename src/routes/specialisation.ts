/**
 * Specialisation Mode — Phase 1.6
 *
 * Exposes domain-specific council adaptation from src/lib/specialisationMode.ts.
 *
 * Routes:
 *   GET  /specialisation/domains       — List available domains + archetype affinities
 *   POST /specialisation/detect        — Auto-detect domain from a question
 *   POST /specialisation/apply         — Apply domain config to a provider list
 */

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  autoDetectDomain,
  applySpecialisationMode,
  DOMAIN_ARCHETYPE_AFFINITY,
  DOMAIN_PREFERRED_TOOLS,
  type SpecialisationDomain,
} from "../lib/specialisationMode.js";
import { env } from "../config/env.js";

const DOMAINS: SpecialisationDomain[] = ["auto", "code", "legal", "medical", "creative", "research"];

const detectSchema = z.object({
  question: z.string().min(1).max(5000),
});

const applySchema = z.object({
  question:  z.string().min(1).max(5000),
  domain:    z.enum(["auto", "code", "legal", "medical", "creative", "research"]).optional().default("auto"),
  /** Array of provider configs to adapt (simplified for API surface) */
  providers: z.array(z.object({
    name:  z.string(),
    model: z.string(),
  })).min(1).max(20),
});

export async function specialisationPlugin(app: FastifyInstance) {

  /**
   * GET /specialisation/domains
   * Lists all available specialisation domains with their archetype affinities
   * and preferred tool categories.
   */
  app.get("/specialisation/domains", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const domains = DOMAINS.filter(d => d !== "auto").map(d => ({
      domain: d,
      archetypeAffinities: DOMAIN_ARCHETYPE_AFFINITY[d as keyof typeof DOMAIN_ARCHETYPE_AFFINITY] ?? {},
      preferredTools:      DOMAIN_PREFERRED_TOOLS[d as keyof typeof DOMAIN_PREFERRED_TOOLS] ?? [],
    }));

    return { success: true, domains, autoDetect: true };
  });

  /**
   * POST /specialisation/detect
   * Automatically infers the best domain for a question.
   */
  app.post("/specialisation/detect", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const parsed = detectSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });

    const domain = autoDetectDomain(parsed.data.question);

    return {
      success: true,
      question: parsed.data.question.slice(0, 100),
      detectedDomain: domain,
      preferredTools: domain !== "auto"
        ? (DOMAIN_PREFERRED_TOOLS[domain as keyof typeof DOMAIN_PREFERRED_TOOLS] ?? [])
        : [],
    };
  });

  /**
   * POST /specialisation/apply
   * Applies domain-specific system prompt injection and archetype biasing
   * to a list of provider configs. Returns the adapted providers.
   */
  app.post("/specialisation/apply", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const parsed = applySchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });

    const { question, domain, providers } = parsed.data;

    const effectiveDomain: SpecialisationDomain = domain === "auto"
      ? autoDetectDomain(question)
      : domain;

    // Build full provider objects for the lib call
    const fullProviders = providers.map(p => ({
      ...p,
      type: "api" as const,
      apiKey: env.OPENAI_API_KEY ?? "",
    }));

    const adapted = applySpecialisationMode(fullProviders, effectiveDomain);

    return {
      success:         true,
      appliedDomain:   effectiveDomain,
      wasAutoDetected: domain === "auto",
      providers:       adapted.map(p => ({
        name:         p.name,
        model:        p.model,
        // Return the first 200 chars of system prompt so caller can inspect injection
        systemPromptPreview: p.systemPrompt?.slice(0, 200),
      })),
    };
  });
}
