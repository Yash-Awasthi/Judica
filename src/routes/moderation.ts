/**
 * Automated Content Moderation — Phase 1.21
 *
 * Exposes the moderation pipeline from src/lib/moderation.ts.
 * Checks text against OpenAI Moderation API or heuristic fallback.
 *
 * Routes:
 *   POST /moderation/check      — Check a single piece of text
 *   POST /moderation/batch      — Check up to 20 texts at once
 *   GET  /moderation/config     — Return active moderation config
 */

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  moderateContent,
  MODERATION_ENABLED,
  BLOCK_THRESHOLD,
  WARN_THRESHOLD,
} from "../lib/moderation.js";

const checkSchema = z.object({
  text:   z.string().min(1).max(50_000),
  /** If true, returns 403 when content is blocked instead of just flagging */
  enforce: z.boolean().optional().default(false),
});

const batchSchema = z.object({
  texts:   z.array(z.string().min(1).max(50_000)).min(1).max(20),
  enforce: z.boolean().optional().default(false),
});

export async function moderationPlugin(app: FastifyInstance) {

  /**
   * POST /moderation/check
   * Check a single text for policy violations.
   */
  app.post("/moderation/check", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const parsed = checkSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });

    const { text, enforce } = parsed.data;
    const result = await moderateContent(text);

    if (enforce && result.blocked) {
      return reply.status(403).send({
        error:      "Content blocked by moderation policy",
        categories: result.categories,
        score:      result.score,
      });
    }

    return {
      success:    true,
      blocked:    result.blocked,
      warned:     result.warned,
      score:      result.score,
      categories: result.categories,
      backend:    result.backend,
    };
  });

  /**
   * POST /moderation/batch
   * Check up to 20 texts at once.
   */
  app.post("/moderation/batch", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const parsed = batchSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });

    const { texts, enforce } = parsed.data;

    const results = await Promise.all(
      texts.map(async (text, index) => {
        const result = await moderateContent(text);
        return { index, ...result };
      })
    );

    const blocked = results.filter(r => r.blocked).length;
    const warned  = results.filter(r => r.warned).length;

    if (enforce && blocked > 0) {
      return reply.status(403).send({
        error:   `${blocked} item(s) blocked by moderation policy`,
        blocked,
        results,
      });
    }

    return {
      success: true,
      total:   texts.length,
      blocked,
      warned,
      passed:  texts.length - blocked,
      results,
    };
  });

  /**
   * GET /moderation/config
   * Returns the active moderation configuration.
   */
  app.get("/moderation/config", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    return {
      success:         true,
      enabled:         MODERATION_ENABLED,
      blockThreshold:  BLOCK_THRESHOLD,
      warnThreshold:   WARN_THRESHOLD,
      backend:         process.env.OPENAI_MODERATION_KEY ? "openai" : "heuristic",
    };
  });
}
