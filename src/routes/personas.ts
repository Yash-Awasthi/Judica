import { Router, Response } from "express";
import { requireAuth } from "../middleware/auth.js";
import prisma from "../lib/db.js";
import type { AuthRequest } from "../types/index.js";
import { AppError } from "../middleware/errorHandler.js";
import { BUILT_IN_PERSONAS } from "../agents/personas.js";

const router = Router();

/**
 * @openapi
 * /api/personas:
 *   get:
 *     tags:
 *       - Personas
 *     summary: List built-in and custom personas
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of personas
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 personas:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id:
 *                         type: string
 *                       name:
 *                         type: string
 *                       systemPrompt:
 *                         type: string
 *                       temperature:
 *                         type: number
 *                       critiqueStyle:
 *                         type: string
 *                         nullable: true
 *                       domain:
 *                         type: string
 *                         nullable: true
 *                       aggressiveness:
 *                         type: integer
 *                       isBuiltIn:
 *                         type: boolean
 *       401:
 *         description: Unauthorized
 */
// GET / — list built-in + user's custom personas
router.get("/", requireAuth, async (req: AuthRequest, res: Response) => {
  const custom = await prisma.customPersona.findMany({
    where: { userId: req.userId! },
    orderBy: { createdAt: "desc" },
  });

  const customMapped = custom.map((p: any) => ({
    id: p.id,
    name: p.name,
    systemPrompt: p.systemPrompt,
    temperature: p.temperature,
    critiqueStyle: p.critiqueStyle,
    domain: p.domain,
    aggressiveness: p.aggressiveness,
    isBuiltIn: false,
    createdAt: p.createdAt,
  }));

  res.json({ personas: [...BUILT_IN_PERSONAS, ...customMapped] });
});

/**
 * @openapi
 * /api/personas:
 *   post:
 *     tags:
 *       - Personas
 *     summary: Create a custom persona
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
 *               - systemPrompt
 *             properties:
 *               name:
 *                 type: string
 *               systemPrompt:
 *                 type: string
 *               temperature:
 *                 type: number
 *                 default: 0.7
 *               critiqueStyle:
 *                 type: string
 *                 nullable: true
 *               domain:
 *                 type: string
 *                 nullable: true
 *               aggressiveness:
 *                 type: integer
 *                 default: 5
 *     responses:
 *       201:
 *         description: Created persona
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *       400:
 *         description: Missing required fields
 *       401:
 *         description: Unauthorized
 */
// POST / — create custom persona
router.post("/", requireAuth, async (req: AuthRequest, res: Response) => {
  const { name, systemPrompt, temperature, critiqueStyle, domain, aggressiveness } = req.body;

  if (!name || typeof name !== "string" || name.trim().length === 0) {
    throw new AppError(400, "Name is required", "PERSONA_NAME_REQUIRED");
  }
  if (!systemPrompt || typeof systemPrompt !== "string" || systemPrompt.trim().length === 0) {
    throw new AppError(400, "System prompt is required", "PERSONA_PROMPT_REQUIRED");
  }

  const persona = await prisma.customPersona.create({
    data: {
      userId: req.userId!,
      name: name.trim(),
      systemPrompt: systemPrompt.trim(),
      temperature: temperature ?? 0.7,
      critiqueStyle: critiqueStyle || null,
      domain: domain || null,
      aggressiveness: aggressiveness ?? 5,
    },
  });

  res.status(201).json(persona);
});

/**
 * @openapi
 * /api/personas/{id}:
 *   put:
 *     tags:
 *       - Personas
 *     summary: Update a custom persona
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Persona ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *               systemPrompt:
 *                 type: string
 *               temperature:
 *                 type: number
 *               critiqueStyle:
 *                 type: string
 *               domain:
 *                 type: string
 *               aggressiveness:
 *                 type: integer
 *     responses:
 *       200:
 *         description: Updated persona
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Persona not found
 */
// PUT /:id — update custom persona
router.put("/:id", requireAuth, async (req: AuthRequest, res: Response) => {
  const persona = await prisma.customPersona.findFirst({
    where: { id: String(req.params.id as string), userId: req.userId! },
  });
  if (!persona) throw new AppError(404, "Persona not found", "PERSONA_NOT_FOUND");

  const { name, systemPrompt, temperature, critiqueStyle, domain, aggressiveness } = req.body;

  const data: Record<string, unknown> = {};
  if (name !== undefined) data.name = name.trim();
  if (systemPrompt !== undefined) data.systemPrompt = systemPrompt.trim();
  if (temperature !== undefined) data.temperature = temperature;
  if (critiqueStyle !== undefined) data.critiqueStyle = critiqueStyle;
  if (domain !== undefined) data.domain = domain;
  if (aggressiveness !== undefined) data.aggressiveness = aggressiveness;

  const updated = await prisma.customPersona.update({
    where: { id: persona.id },
    data,
  });

  res.json(updated);
});

/**
 * @openapi
 * /api/personas/{id}:
 *   delete:
 *     tags:
 *       - Personas
 *     summary: Delete a custom persona
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Persona ID
 *     responses:
 *       200:
 *         description: Persona deleted
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Persona not found
 */
// DELETE /:id — delete custom persona
router.delete("/:id", requireAuth, async (req: AuthRequest, res: Response) => {
  const persona = await prisma.customPersona.findFirst({
    where: { id: String(req.params.id as string), userId: req.userId! },
  });
  if (!persona) throw new AppError(404, "Persona not found", "PERSONA_NOT_FOUND");

  await prisma.customPersona.delete({ where: { id: persona.id } });
  res.json({ success: true });
});

export default router;
