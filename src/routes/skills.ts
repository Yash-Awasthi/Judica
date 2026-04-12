import { Router, Response } from "express";
import { AuthRequest } from "../types/index.js";
import { AppError } from "../middleware/errorHandler.js";
import prisma from "../lib/db.js";
import logger from "../lib/logger.js";
import { executeUserSkill } from "../lib/tools/skillExecutor.js";

const router = Router();

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
router.get("/", async (req: AuthRequest, res: Response) => {
  const skills = await prisma.userSkill.findMany({
    where: { userId: String(req.userId) },
    orderBy: { createdAt: "desc" },
  });
  res.json({ skills });
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
router.post("/", async (req: AuthRequest, res: Response) => {
  const { name, description, code, parameters } = req.body;

  if (!name || !description || !code) {
    throw new AppError(400, "name, description, and code are required", "MISSING_FIELDS");
  }

  if (typeof code !== "string" || code.length > 50_000) {
    throw new AppError(400, "Code must be a string under 50,000 characters", "CODE_TOO_LONG");
  }

  const skill = await prisma.userSkill.create({
    data: {
      userId: String(req.userId),
      name: name.trim(),
      description: description.trim(),
      code,
      parameters: parameters || {},
    },
  });

  logger.info({ userId: req.userId, skillId: skill.id }, "Skill created");
  res.status(201).json(skill);
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
router.put("/:id", async (req: AuthRequest, res: Response) => {
  const id = String(req.params.id);
  const skill = await prisma.userSkill.findUnique({ where: { id } });

  if (!skill) {
    throw new AppError(404, "Skill not found", "SKILL_NOT_FOUND");
  }
  if (skill.userId !== String(req.userId)) {
    throw new AppError(403, "Not authorized to update this skill", "FORBIDDEN");
  }

  const { name, description, code, parameters, active } = req.body;

  const updated = await prisma.userSkill.update({
    where: { id },
    data: {
      ...(name !== undefined && { name: name.trim() }),
      ...(description !== undefined && { description: description.trim() }),
      ...(code !== undefined && { code }),
      ...(parameters !== undefined && { parameters }),
      ...(active !== undefined && { active }),
    },
  });

  res.json(updated);
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
router.delete("/:id", async (req: AuthRequest, res: Response) => {
  const id = String(req.params.id);
  const skill = await prisma.userSkill.findUnique({ where: { id } });

  if (!skill) {
    throw new AppError(404, "Skill not found", "SKILL_NOT_FOUND");
  }
  if (skill.userId !== String(req.userId)) {
    throw new AppError(403, "Not authorized to delete this skill", "FORBIDDEN");
  }

  await prisma.userSkill.delete({ where: { id } });
  logger.info({ userId: req.userId, skillId: id }, "Skill deleted");
  res.json({ success: true });
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
router.post("/:id/test", async (req: AuthRequest, res: Response) => {
  const id = String(req.params.id);
  const skill = await prisma.userSkill.findUnique({ where: { id } });

  if (!skill) {
    throw new AppError(404, "Skill not found", "SKILL_NOT_FOUND");
  }
  if (skill.userId !== String(req.userId)) {
    throw new AppError(403, "Not authorized to test this skill", "FORBIDDEN");
  }

  const { inputs } = req.body;

  try {
    const result = await executeUserSkill(String(req.userId), skill.name, inputs || {});
    res.json({ success: true, result });
  } catch (err: any) {
    res.json({ success: false, error: err.message });
  }
});

export default router;
