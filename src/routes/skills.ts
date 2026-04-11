import { Router, Response } from "express";
import { AuthRequest } from "../types/index.js";
import { AppError } from "../middleware/errorHandler.js";
import prisma from "../lib/db.js";
import logger from "../lib/logger.js";
import { executeUserSkill } from "../lib/tools/skillExecutor.js";

const router = Router();

// GET / — list user's skills
router.get("/", async (req: AuthRequest, res: Response) => {
  const skills = await prisma.userSkill.findMany({
    where: { userId: String(req.userId) },
    orderBy: { createdAt: "desc" },
  });
  res.json({ skills });
});

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
