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

/**
 * @openapi
 * /api/council/archetypes:
 *   get:
 *     tags:
 *       - Council
 *     summary: List all available archetypes
 *     responses:
 *       200:
 *         description: List of archetypes
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 archetypes:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id:
 *                         type: string
 *                       name:
 *                         type: string
 *                       thinkingStyle:
 *                         type: string
 *                       asks:
 *                         type: string
 *                       blindSpot:
 *                         type: string
 *                       icon:
 *                         type: string
 *                       colorBg:
 *                         type: string
 */
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

/**
 * @openapi
 * /api/council/summons:
 *   get:
 *     tags:
 *       - Council
 *     summary: List all available summon configurations
 *     responses:
 *       200:
 *         description: List of summons
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 summons:
 *                   type: array
 *                   items:
 *                     type: object
 */
router.get("/summons", (req: Request, res: Response) => {
  res.json({ summons: SUMMONS });
});

/**
 * @openapi
 * /api/council/templates:
 *   get:
 *     tags:
 *       - Council
 *     summary: List council templates
 *     responses:
 *       200:
 *         description: List of council templates
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 templates:
 *                   type: array
 *                   items:
 *                     type: object
 */
router.get("/templates", (req: Request, res: Response) => {
  res.json({ templates: COUNCIL_TEMPLATES });
});

/**
 * @openapi
 * /api/council/config:
 *   get:
 *     tags:
 *       - Council
 *     summary: Get the user's council configuration
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Council configuration
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 config:
 *                   type: object
 *                   nullable: true
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Failed to get council config
 */
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

/**
 * @openapi
 * /api/council/config:
 *   put:
 *     tags:
 *       - Council
 *     summary: Update the user's council configuration
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               customArchetypes:
 *                 type: array
 *                 items:
 *                   type: object
 *                   required:
 *                     - id
 *                     - name
 *                     - thinkingStyle
 *                     - asks
 *                     - blindSpot
 *                     - systemPrompt
 *                   properties:
 *                     id:
 *                       type: string
 *                     name:
 *                       type: string
 *                     thinkingStyle:
 *                       type: string
 *                     asks:
 *                       type: string
 *                     blindSpot:
 *                       type: string
 *                     systemPrompt:
 *                       type: string
 *                     tools:
 *                       type: array
 *                       items:
 *                         type: string
 *                     icon:
 *                       type: string
 *                     colorBg:
 *                       type: string
 *               defaultSummon:
 *                 type: string
 *               defaultRounds:
 *                 type: integer
 *                 minimum: 1
 *                 maximum: 5
 *     responses:
 *       200:
 *         description: Updated council configuration
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 config:
 *                   type: object
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Failed to update council config
 */
router.put("/config", requireAuth, validate(updateConfigSchema), async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const config = req.body;

    const updated = await prisma.councilConfig.upsert({
      where: { userId },
      update: { config },
      create: { userId, config } as any,
    });

    res.json({ config: updated.config });
  } catch (err) {
    logger.error({ err: (err as Error).message }, "Failed to update council config");
    throw new AppError(500, "Failed to update council config", "COUNCIL_CONFIG_UPDATE_FAILED");
  }
});

/**
 * @openapi
 * /api/council/config:
 *   delete:
 *     tags:
 *       - Council
 *     summary: Delete the user's council configuration
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Council config deleted
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Failed to delete council config
 */
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

/**
 * @openapi
 * /api/council/archetypes/{id}:
 *   get:
 *     tags:
 *       - Council
 *     summary: Get a specific archetype by ID
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Archetype ID
 *     responses:
 *       200:
 *         description: Archetype details
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 archetype:
 *                   type: object
 *       404:
 *         description: Archetype not found
 */
router.get("/archetypes/:id", (req: Request, res: Response) => {
  const id = String(req.params.id as string);
  const archetype = ARCHETYPES[id];

  if (!archetype) {
    return res.status(404).json({ error: "Archetype not found" });
  }

  res.json({ archetype });
});

export default router;
