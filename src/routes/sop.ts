/**
 * SOP-Driven Agent Mode — Phase 1.20
 *
 * Exposes the Standard Operating Procedure workflow from src/lib/sopWorkflow.ts.
 * Instead of a single parallel council call, the council follows a structured
 * multi-step procedure (e.g. Research → Analyze → Critique → Synthesize).
 *
 * Routes:
 *   GET  /sop/templates        — List built-in SOP templates
 *   POST /sop/run              — Run a question through a SOP (built-in or custom)
 */

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { runSOPWorkflow, SOP_TEMPLATES } from "../lib/sopWorkflow.js";
import { env } from "../config/env.js";

// Default provider used for SOP steps
const defaultProvider = (step: string) => ({
  name:   `sop-${step}`,
  type:   "api" as const,
  apiKey: env.OPENAI_API_KEY ?? env.ANTHROPIC_API_KEY ?? "",
  model:  env.OPENAI_API_KEY ? "gpt-4o-mini" : "claude-3-haiku-20240307",
});

const sopStepSchema = z.object({
  name:            z.string().min(1).max(100),
  roleDescription: z.string().min(1).max(1000),
  inputFrom:       z.enum(["question", "previous", "all"]).optional().default("previous"),
});

const runSchema = z.object({
  question:   z.string().min(1).max(10_000),
  /** Use a built-in template name, or omit to provide custom steps */
  template:   z.enum(["research_analyze", "debate_resolve", "product_design"]).optional(),
  /** Custom SOP steps (used when template is not provided). Min 2, max 10 steps. */
  steps:      z.array(sopStepSchema).min(2).max(10).optional(),
  /** Max tokens per step. Default: 800 */
  maxTokens:  z.number().int().min(100).max(4000).optional().default(800),
});

export async function sopPlugin(app: FastifyInstance) {

  /**
   * GET /sop/templates
   * Lists all built-in SOP templates with their steps.
   */
  app.get("/sop/templates", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const templates = Object.entries(SOP_TEMPLATES).map(([key, steps]) => ({
      id:    key,
      steps: steps.map(s => ({ name: s.name, role: s.roleDescription.slice(0, 80) })),
      stepCount: steps.length,
    }));

    return { success: true, templates };
  });

  /**
   * POST /sop/run
   * Runs a question through a structured SOP workflow.
   * Each step is executed sequentially; output feeds into subsequent steps.
   * Returns each step's output plus a final synthesis.
   */
  app.post("/sop/run", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const parsed = runSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });

    const { question, template, steps, maxTokens } = parsed.data;

    // Resolve steps: either from template or custom
    let resolvedSteps = steps ?? (template ? SOP_TEMPLATES[template] : null);
    if (!resolvedSteps || resolvedSteps.length === 0) {
      return reply.status(400).send({
        error: "Provide either a template name or a custom steps array",
      });
    }

    // Build one provider per step (each gets its own role description via systemPrompt)
    const members = resolvedSteps.map(step => ({
      ...defaultProvider(step.name),
      systemPrompt: step.roleDescription,
    }));

    const result = await runSOPWorkflow(question, members, resolvedSteps, maxTokens);

    return {
      success:       true,
      template:      template ?? "custom",
      stepCount:     result.steps.length,
      steps:         result.steps,
      finalSynthesis: result.finalSynthesis,
    };
  });
}
