import { FastifyPluginAsync } from "fastify";
import { randomUUID } from "crypto";
import { db } from "../lib/drizzle.js";
import { userSkills } from "../db/schema/marketplace.js";
import { eq, desc } from "drizzle-orm";
import { fastifyRequireAuth } from "../middleware/fastifyAuth.js";
import { AppError } from "../middleware/errorHandler.js";
import logger from "../lib/logger.js";
import { executeUserSkill } from "../lib/tools/skillExecutor.js";

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
    const { name, description, code, parameters } = request.body as {
      name?: string;
      description?: string;
      code?: string;
      parameters?: Record<string, unknown>;
    };

    if (!name || !description || !code) {
      throw new AppError(400, "name, description, and code are required", "MISSING_FIELDS");
    }

    if (typeof code !== "string" || code.length > 50_000) {
      throw new AppError(400, "Code must be a string under 50,000 characters", "CODE_TOO_LONG");
    }

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
      })
      .returning();

    logger.info({ userId: request.userId, skillId: skill.id }, "Skill created");
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

    const { name, description, code, parameters, active } = request.body as {
      name?: string;
      description?: string;
      code?: string;
      parameters?: Record<string, unknown>;
      active?: boolean;
    };

    const updateData: Record<string, unknown> = {};
    if (name !== undefined) updateData.name = name.trim();
    if (description !== undefined) updateData.description = description.trim();
    if (code !== undefined) updateData.code = code;
    if (parameters !== undefined) updateData.parameters = parameters;
    if (active !== undefined) updateData.active = active;

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
};

export default skillsPlugin;
