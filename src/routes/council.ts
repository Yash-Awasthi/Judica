import { Router, Request, Response } from "express";
import { z } from "zod";
import { validate } from "../middleware/validate.js";
import { ARCHETYPES, SUMMONS, COUNCIL_TEMPLATES } from "../config/archetypes.js";
import prisma from "../lib/db.js";
import logger from "../lib/logger.js";
import { requireAuth } from "../middleware/auth.js";
import { AuthRequest } from "../types/index.js";
import { AppError } from "../middleware/errorHandler.js";

const router = Router();

router.get("/archetypes", (req: Request, res: Response) => {
  const archetypes = Object.values(ARCHETYPES).map((a) => ({
    id: a.id,
    name: a.name,
    thinkingStyle: a.thinkingStyle,
    asks: a.asks,
    blindSpot: a.blindSpot,
    icon: a.icon,
    colorBg: a.colorBg,
  }));
  res.json({ archetypes });
});

router.get("/summons", (req: Request, res: Response) => {
  res.json({ summons: SUMMONS });
});

router.get("/templates", (req: Request, res: Response) => {
  res.json({ templates: COUNCIL_TEMPLATES });
});

router.get("/config", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const config = await prisma.councilConfig.findUnique({
      where: { userId },
    });
    res.json({ config: config?.config || null });
  } catch (err) {
    logger.error({ err: (err as Error).message }, "Failed to get council config");
    throw new AppError(500, "Failed to get council config", "COUNCIL_CONFIG_FETCH_FAILED");
  }
});

const updateConfigSchema = z.object({
  body: z.object({
    customArchetypes: z.array(z.object({
      id: z.string(),
      name: z.string(),
      thinkingStyle: z.string(),
      asks: z.string(),
      blindSpot: z.string(),
      systemPrompt: z.string(),
      tools: z.array(z.string()).optional(),
      icon: z.string().optional(),
      colorBg: z.string().optional(),
    })).optional(),
    defaultSummon: z.string().optional(),
    defaultRounds: z.number().min(1).max(5).optional(),
  }),
});

router.put("/config", requireAuth, validate(updateConfigSchema), async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const config = req.body;

    const updated = await prisma.councilConfig.upsert({
      where: { userId },
      update: { config },
      create: { userId, config },
    });

    res.json({ config: updated.config });
  } catch (err) {
    logger.error({ err: (err as Error).message }, "Failed to update council config");
    throw new AppError(500, "Failed to update council config", "COUNCIL_CONFIG_UPDATE_FAILED");
  }
});

router.delete("/config", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId!;

    await prisma.councilConfig.deleteMany({
      where: { userId },
    });

    res.json({ message: "Council config deleted" });
  } catch (err) {
    logger.error({ err: (err as Error).message }, "Failed to delete council config");
    throw new AppError(500, "Failed to delete council config", "COUNCIL_CONFIG_DELETE_FAILED");
  }
});

router.get("/archetypes/:id", (req: Request, res: Response) => {
  const id = String(req.params.id);
  const archetype = ARCHETYPES[id];

  if (!archetype) {
    return res.status(404).json({ error: "Archetype not found" });
  }

  res.json({ archetype });
});

export default router;