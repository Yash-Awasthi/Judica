import { FastifyPluginAsync } from "fastify";
import { randomUUID } from "crypto";
import { db } from "../lib/drizzle.js";
import { userSkills } from "../db/schema/marketplace.js";
import { eq, and, desc } from "drizzle-orm";
import { fastifyRequireAuth } from "../middleware/fastifyAuth.js";
import { AppError } from "../middleware/errorHandler.js";
import logger from "../lib/logger.js";
import { executeUserSkill } from "../lib/tools/skillExecutor.js";

const skillsPlugin: FastifyPluginAsync = async (fastify) => {
  /**
   * @openapi
   * /skills:
   *   get:
   *     summary: List user's skills
   *     description: Returns all skills owned by the authenticated user, ordered by creation date descending.
   *     tags:
   *       - Skills
   *     security:
   *       - bearerAuth: []
   *     responses:
   *       200:
   *         description: A list of skills
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 skills:
   *                   type: array
   *                   items:
   *                     $ref: '#/components/schemas/Skill'
   */
  // GET / — list user's skills
  fastify.get("/", { preHandler: fastifyRequireAuth }, async (request, reply) => {
    const skills = await db
      .select()
      .from(userSkills)
      .where(eq(userSkills.userId, request.userId!))
      .orderBy(desc(userSkills.createdAt));

    return { skills };
  });

  /**
   * @openapi
   * /skills:
   *   post:
   *     summary: Create a new skill
   *     description: Creates a new user skill with the provided name, description, code, and optional parameters.
   *     tags:
   *       - Skills
   *     security:
   *       - bearerAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required:
   *               - name
   *               - description
   *               - code
   *             properties:
   *               name:
   *                 type: string
   *                 description: The skill name
   *               description:
   *                 type: string
   *                 description: A description of what the skill does
   *               code:
   *                 type: string
   *                 maxLength: 50000
   *                 description: The skill source code (max 50,000 characters)
   *               parameters:
   *                 type: object
   *                 description: Optional parameter definitions for the skill
   *     responses:
   *       201:
   *         description: Skill created successfully
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/Skill'
   *       400:
   *         description: Missing required fields or code exceeds size limit
   */
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

  /**
   * @openapi
   * /skills/{id}:
   *   put:
   *     summary: Update a skill
   *     description: Updates an existing skill. Only the skill owner can perform this operation. All fields are optional.
   *     tags:
   *       - Skills
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *         description: The skill ID
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               name:
   *                 type: string
   *                 description: Updated skill name
   *               description:
   *                 type: string
   *                 description: Updated skill description
   *               code:
   *                 type: string
   *                 description: Updated skill source code
   *               parameters:
   *                 type: object
   *                 description: Updated parameter definitions
   *               active:
   *                 type: boolean
   *                 description: Whether the skill is active
   *     responses:
   *       200:
   *         description: Skill updated successfully
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/Skill'
   *       403:
   *         description: Not authorized to update this skill
   *       404:
   *         description: Skill not found
   */
  // PUT /:id — update skill (owner only)
  fastify.put("/:id", { preHandler: fastifyRequireAuth }, async (request, reply) => {
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

  /**
   * @openapi
   * /skills/{id}:
   *   delete:
   *     summary: Delete a skill
   *     description: Permanently deletes a skill. Only the skill owner can perform this operation.
   *     tags:
   *       - Skills
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *         description: The skill ID
   *     responses:
   *       200:
   *         description: Skill deleted successfully
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 success:
   *                   type: boolean
   *                   example: true
   *       403:
   *         description: Not authorized to delete this skill
   *       404:
   *         description: Skill not found
   */
  // DELETE /:id — delete skill (owner only)
  fastify.delete("/:id", { preHandler: fastifyRequireAuth }, async (request, reply) => {
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

  /**
   * @openapi
   * /skills/{id}/test:
   *   post:
   *     summary: Test execute a skill
   *     description: Runs the skill with the provided sample inputs and returns the result. Only the skill owner can test it.
   *     tags:
   *       - Skills
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *         description: The skill ID
   *     requestBody:
   *       required: false
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               inputs:
   *                 type: object
   *                 description: Sample input values to pass to the skill
   *     responses:
   *       200:
   *         description: Skill execution result
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 success:
   *                   type: boolean
   *                 result:
   *                   description: The skill execution output (present when success is true)
   *                 error:
   *                   type: string
   *                   description: Error message (present when success is false)
   *       403:
   *         description: Not authorized to test this skill
   *       404:
   *         description: Skill not found
   */
  // POST /:id/test — test execute skill with sample inputs
  fastify.post("/:id/test", { preHandler: fastifyRequireAuth }, async (request, reply) => {
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
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });
};

export default skillsPlugin;
