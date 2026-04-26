/**
 * Intelligent Skill Selection — Phase 1.19
 *
 * Exposes automatic skill/tool pre-selection from src/lib/skillSelection.ts.
 * Before sending a question to the council, this endpoint selects the most
 * relevant skills from the user's library to include as context.
 *
 * Routes:
 *   POST /skill-selection/select   — Select relevant skills for a question
 *   POST /skill-selection/preview  — Preview the context block injected into the council
 */

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { selectRelevantSkills, buildSkillContextBlock } from "../lib/skillSelection.js";

const selectSchema = z.object({
  question: z.string().min(1).max(5000),
  /** Maximum number of skills to return. Default: 5 */
  maxSkills: z.number().int().min(1).max(20).optional().default(5),
  /** Minimum relevance score threshold (0–1). Default: 0.1 */
  minScore: z.number().min(0).max(1).optional().default(0.1),
});

export async function skillSelectionPlugin(app: FastifyInstance) {

  /**
   * POST /skill-selection/select
   * Returns the most relevant skills for the given question.
   * Skills are ranked by keyword overlap (Jaccard similarity) against
   * skill name, description, and tags.
   */
  app.post("/skill-selection/select", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const parsed = selectSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });

    const { question, maxSkills, minScore } = parsed.data;

    const skills = await selectRelevantSkills(userId, question, maxSkills, minScore);

    return {
      success:        true,
      question:       question.slice(0, 100),
      selectedSkills: skills,
      count:          skills.length,
    };
  });

  /**
   * POST /skill-selection/preview
   * Returns the formatted context block that would be injected into the
   * council system prompt for the given question.
   */
  app.post("/skill-selection/preview", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const parsed = selectSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });

    const { question, maxSkills, minScore } = parsed.data;

    const skills = await selectRelevantSkills(userId, question, maxSkills, minScore);
    const contextBlock = buildSkillContextBlock(skills);

    return {
      success:      true,
      skillCount:   skills.length,
      contextBlock: contextBlock || null,
      injected:     contextBlock.length > 0,
    };
  });
}
