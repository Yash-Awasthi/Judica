import type { FastifyPluginAsync } from "fastify";
import { randomUUID } from "crypto";
import { db } from "../lib/drizzle.js";
import { userSkills } from "../db/schema/marketplace.js";
import { marketplaceItems } from "../db/schema/marketplace.js";
import { eq, desc } from "drizzle-orm";
import { fastifyRequireAuth } from "../middleware/fastifyAuth.js";
import { AppError } from "../middleware/errorHandler.js";
import logger from "../lib/logger.js";
import { executeUserSkill } from "../lib/tools/skillExecutor.js";
import { users } from "../db/schema/users.js";

const skillsPlugin: FastifyPluginAsync = async (fastify) => {
    // GET / — list user's skills
  fastify.get("/", { preHandler: fastifyRequireAuth }, async (request, _reply) => {
    const skills = await db
      .select()
      .from(userSkills)
      .where(eq(userSkills.userId, request.userId!))
      .orderBy(desc(userSkills.createdAt));

    return { skills };
  });

    // POST / — create skill
  fastify.post("/", { preHandler: fastifyRequireAuth }, async (request, reply) => {
    // Phase 1.3 — Dify-style tool builder: accept language, version, inputSchema
    const { name, description, code, parameters, language, version, inputSchema } = request.body as {
      name?: string;
      description?: string;
      code?: string;
      parameters?: Record<string, unknown>;
      language?: string;
      version?: string;
      inputSchema?: Record<string, unknown>;
    };

    if (!name || !description || !code) {
      throw new AppError(400, "name, description, and code are required", "MISSING_FIELDS");
    }

    if (typeof code !== "string" || code.length > 50_000) {
      throw new AppError(400, "Code must be a string under 50,000 characters", "CODE_TOO_LONG");
    }

    const allowedLanguages = ["python", "javascript"];
    const resolvedLanguage = allowedLanguages.includes(language ?? "") ? language! : "python";

    const id = randomUUID();
    const [skill] = await db
      .insert(userSkills)
      .values({
        id,
        userId: request.userId!,
        name: name.trim(),
        description: description.trim(),
        code,
        parameters: parameters || {},
        language: resolvedLanguage,
        version: version?.trim() || "1.0.0",
        inputSchema: inputSchema || null,
      })
      .returning();

    logger.info({ userId: request.userId, skillId: skill.id, language: resolvedLanguage }, "Skill created");
    reply.code(201);
    return skill;
  });

    // PUT /:id — update skill (owner only)
  fastify.put("/:id", { preHandler: fastifyRequireAuth }, async (request, _reply) => {
    const { id } = request.params as { id: string };

    const [skill] = await db
      .select()
      .from(userSkills)
      .where(eq(userSkills.id, id));

    if (!skill) {
      throw new AppError(404, "Skill not found", "SKILL_NOT_FOUND");
    }
    if (skill.userId !== request.userId) {
      throw new AppError(403, "Not authorized to update this skill", "FORBIDDEN");
    }

    const { name, description, code, parameters, active, language, version, inputSchema } = request.body as {
      name?: string;
      description?: string;
      code?: string;
      parameters?: Record<string, unknown>;
      active?: boolean;
      language?: string;
      version?: string;
      inputSchema?: Record<string, unknown> | null;
    };

    const updateData: Record<string, unknown> = {};
    if (name !== undefined) {
      if (typeof name !== "string" || name.trim().length > 200) {
        throw new AppError(400, "Name must be a string under 200 characters", "NAME_TOO_LONG");
      }
      updateData.name = name.trim();
    }
    if (description !== undefined) {
      if (typeof description !== "string" || description.trim().length > 2000) {
        throw new AppError(400, "Description must be a string under 2,000 characters", "DESCRIPTION_TOO_LONG");
      }
      updateData.description = description.trim();
    }
    if (code !== undefined) {
      if (typeof code !== "string" || code.length > 50_000) {
        throw new AppError(400, "Code must be a string under 50,000 characters", "CODE_TOO_LONG");
      }
      updateData.code = code;
    }
    if (parameters !== undefined) updateData.parameters = parameters;
    if (active !== undefined) updateData.active = active;
    if (language !== undefined) {
      const allowed = ["python", "javascript"];
      updateData.language = allowed.includes(language) ? language : "python";
    }
    if (version !== undefined) updateData.version = version.trim();
    if (inputSchema !== undefined) updateData.inputSchema = inputSchema;
    updateData.updatedAt = new Date();

    const [updated] = await db
      .update(userSkills)
      .set(updateData)
      .where(eq(userSkills.id, id))
      .returning();

    return updated;
  });

    // DELETE /:id — delete skill (owner only)
  fastify.delete("/:id", { preHandler: fastifyRequireAuth }, async (request, _reply) => {
    const { id } = request.params as { id: string };

    const [skill] = await db
      .select()
      .from(userSkills)
      .where(eq(userSkills.id, id));

    if (!skill) {
      throw new AppError(404, "Skill not found", "SKILL_NOT_FOUND");
    }
    if (skill.userId !== request.userId) {
      throw new AppError(403, "Not authorized to delete this skill", "FORBIDDEN");
    }

    await db.delete(userSkills).where(eq(userSkills.id, id));
    logger.info({ userId: request.userId, skillId: id }, "Skill deleted");
    return { success: true };
  });

    // POST /:id/test — test execute skill with sample inputs
  fastify.post("/:id/test", { preHandler: fastifyRequireAuth }, async (request, _reply) => {
    const { id } = request.params as { id: string };

    const [skill] = await db
      .select()
      .from(userSkills)
      .where(eq(userSkills.id, id));

    if (!skill) {
      throw new AppError(404, "Skill not found", "SKILL_NOT_FOUND");
    }
    if (skill.userId !== request.userId) {
      throw new AppError(403, "Not authorized to test this skill", "FORBIDDEN");
    }

    const { inputs } = request.body as { inputs?: Record<string, unknown> };

    try {
      const result = await executeUserSkill(request.userId!, skill.name, inputs || {});
      return { success: true, result };
    } catch (err: unknown) {
      return { success: false, error: (err as Error).message };
    }
  });

  // POST /:id/publish — publish skill to marketplace (Dify marketplace pattern)
  fastify.post("/:id/publish", { preHandler: fastifyRequireAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };

    const [skill] = await db
      .select()
      .from(userSkills)
      .where(eq(userSkills.id, id));

    if (!skill) throw new AppError(404, "Skill not found", "SKILL_NOT_FOUND");
    if (skill.userId !== request.userId) throw new AppError(403, "Not authorized", "FORBIDDEN");

    // Fetch author info for marketplace listing
    const [author] = await db.select({ username: users.username }).from(users).where(eq(users.id, request.userId!)).limit(1);

    const marketplaceId = `skill:${id}`;
    await db
      .insert(marketplaceItems)
      .values({
        id: marketplaceId,
        type: "tool",
        name: skill.name,
        description: skill.description,
        content: {
          code: skill.code,
          language: skill.language,
          version: skill.version,
          inputSchema: skill.inputSchema,
          parameters: skill.parameters,
        },
        authorId: request.userId!,
        authorName: author?.username ?? "unknown",
        tags: [skill.language, "skill", "tool"],
        version: skill.version,
        published: true,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: marketplaceItems.id,
        set: {
          name: skill.name,
          description: skill.description,
          content: {
            code: skill.code,
            language: skill.language,
            version: skill.version,
            inputSchema: skill.inputSchema,
            parameters: skill.parameters,
          },
          version: skill.version,
          published: true,
          updatedAt: new Date(),
        },
      });

    await db
      .update(userSkills)
      .set({ publishedToMarketplace: true, updatedAt: new Date() })
      .where(eq(userSkills.id, id));

    logger.info({ userId: request.userId, skillId: id }, "Skill published to marketplace");
    reply.code(200);
    return { success: true, marketplaceId };
  });
};

export default skillsPlugin;
