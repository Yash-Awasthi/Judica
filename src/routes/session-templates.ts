/**
 * Session Templates — Phase 1.22
 *
 * Pre-configured council session setups that users can save and reuse.
 * Each template captures: name, council members, master, summon type,
 * deliberation mode, system prompt, and optional default question.
 *
 * Inspired by:
 * - TypingMind (typingmind.com) — saved "chat profiles" with per-profile
 *   model + system prompt + persona configuration
 * - Open WebUI (MIT, open-webui/open-webui) — model presets / prompt templates
 *
 * GET    /session-templates              — list user's templates
 * POST   /session-templates              — save a new template
 * GET    /session-templates/:id          — get a specific template
 * PUT    /session-templates/:id          — update a template
 * DELETE /session-templates/:id          — delete a template
 * POST   /session-templates/:id/apply    — return the template config as an ask payload
 */

import type { FastifyPluginAsync } from "fastify";
import { db } from "../lib/drizzle.js";
import { sessionTemplates } from "../db/schema/sessionTemplates.js";
import { eq, and, desc } from "drizzle-orm";
import { fastifyRequireAuth } from "../middleware/fastifyAuth.js";
import { z } from "zod";
import { providerSchema } from "../middleware/validate.js";

const templateSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  icon: z.string().max(50).optional(),
  councilMembers: z.array(providerSchema).max(10).optional(),
  master: providerSchema.optional(),
  summon: z.enum(["business", "technical", "personal", "creative", "ethical", "strategy", "debate", "research", "default"]).optional(),
  deliberationMode: z.enum(["standard", "socratic", "red_blue", "hypothesis", "confidence"]).optional(),
  sopTemplate: z.enum(["research_analyze", "debate_resolve", "product_design"]).optional(),
  systemPrompt: z.string().max(5000).optional(),
  defaultQuestion: z.string().max(1000).optional(),
  maxTokens: z.number().int().min(256).max(8192).optional(),
  isPublic: z.boolean().default(false),
});

export const sessionTemplatesPlugin: FastifyPluginAsync = async (fastify) => {
  fastify.addHook("preHandler", fastifyRequireAuth);

  // GET /session-templates
  fastify.get("/session-templates", async (request: any) => {
    const rows = await db
      .select()
      .from(sessionTemplates)
      .where(eq(sessionTemplates.userId, request.user.userId))
      .orderBy(desc(sessionTemplates.createdAt));
    return { templates: rows };
  });

  // POST /session-templates
  fastify.post("/session-templates", async (request: any, reply: any) => {
    const body = templateSchema.safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({ error: "Validation failed", details: body.error.issues });
    }
    const d = body.data;

    const [template] = await db
      .insert(sessionTemplates)
      .values({
        userId: request.user.userId,
        name: d.name,
        description: d.description ?? null,
        icon: d.icon ?? null,
        config: {
          councilMembers: d.councilMembers ?? null,
          master: d.master ?? null,
          summon: d.summon ?? null,
          deliberationMode: d.deliberationMode ?? null,
          sopTemplate: d.sopTemplate ?? null,
          systemPrompt: d.systemPrompt ?? null,
          defaultQuestion: d.defaultQuestion ?? null,
          maxTokens: d.maxTokens ?? null,
        },
        isPublic: d.isPublic,
      })
      .returning();

    return reply.code(201).send({ template });
  });

  // GET /session-templates/:id
  fastify.get("/session-templates/:id", async (request: any, reply: any) => {
    const [template] = await db
      .select()
      .from(sessionTemplates)
      .where(and(
        eq(sessionTemplates.id, (request.params as any).id),
        eq(sessionTemplates.userId, request.user.userId),
      ))
      .limit(1);

    if (!template) return reply.code(404).send({ error: "Template not found" });
    return { template };
  });

  // PUT /session-templates/:id
  fastify.put("/session-templates/:id", async (request: any, reply: any) => {
    const userId = request.user.userId;
    const { id } = request.params as { id: string };
    const body = templateSchema.partial().safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({ error: "Validation failed", details: body.error.issues });
    }

    const update: Record<string, unknown> = { updatedAt: new Date() };
    const d = body.data;
    if (d.name !== undefined) update.name = d.name;
    if (d.description !== undefined) update.description = d.description;
    if (d.icon !== undefined) update.icon = d.icon;
    if (d.isPublic !== undefined) update.isPublic = d.isPublic;
    if (d.councilMembers !== undefined || d.master !== undefined || d.summon !== undefined ||
        d.deliberationMode !== undefined || d.systemPrompt !== undefined || d.defaultQuestion !== undefined) {
      // Merge config fields
      const [existing] = await db.select().from(sessionTemplates)
        .where(and(eq(sessionTemplates.id, id), eq(sessionTemplates.userId, userId))).limit(1);
      const existingConfig = (existing?.config as Record<string, unknown>) ?? {};
      update.config = {
        ...existingConfig,
        ...(d.councilMembers !== undefined ? { councilMembers: d.councilMembers } : {}),
        ...(d.master !== undefined ? { master: d.master } : {}),
        ...(d.summon !== undefined ? { summon: d.summon } : {}),
        ...(d.deliberationMode !== undefined ? { deliberationMode: d.deliberationMode } : {}),
        ...(d.sopTemplate !== undefined ? { sopTemplate: d.sopTemplate } : {}),
        ...(d.systemPrompt !== undefined ? { systemPrompt: d.systemPrompt } : {}),
        ...(d.defaultQuestion !== undefined ? { defaultQuestion: d.defaultQuestion } : {}),
        ...(d.maxTokens !== undefined ? { maxTokens: d.maxTokens } : {}),
      };
    }

    const [updated] = await db
      .update(sessionTemplates)
      .set(update)
      .where(and(eq(sessionTemplates.id, id), eq(sessionTemplates.userId, userId)))
      .returning();

    if (!updated) return reply.code(404).send({ error: "Template not found" });
    return { template: updated };
  });

  // DELETE /session-templates/:id
  fastify.delete("/session-templates/:id", async (request: any, reply: any) => {
    const [deleted] = await db
      .delete(sessionTemplates)
      .where(and(
        eq(sessionTemplates.id, (request.params as any).id),
        eq(sessionTemplates.userId, request.user.userId),
      ))
      .returning();

    if (!deleted) return reply.code(404).send({ error: "Template not found" });
    return { success: true };
  });

  // POST /session-templates/:id/apply — return template as ask payload
  fastify.post("/session-templates/:id/apply", async (request: any, reply: any) => {
    const [template] = await db
      .select()
      .from(sessionTemplates)
      .where(and(
        eq(sessionTemplates.id, (request.params as any).id),
        eq(sessionTemplates.userId, request.user.userId),
      ))
      .limit(1);

    if (!template) return reply.code(404).send({ error: "Template not found" });

    const config = (template.config as Record<string, unknown>) ?? {};
    return {
      askPayload: {
        members: config.councilMembers ?? undefined,
        master: config.master ?? undefined,
        summon: config.summon ?? undefined,
        deliberation_mode: config.deliberationMode ?? "standard",
        sop_template: config.sopTemplate ?? undefined,
        maxTokens: config.maxTokens ?? undefined,
        question: config.defaultQuestion ?? "",
      },
    };
  });
};
