import { Router, Response } from "express";
import { requireAuth } from "../middleware/auth.js";
import prisma from "../lib/db.js";
import type { AuthRequest } from "../types/index.js";
import { AppError } from "../middleware/errorHandler.js";

const router = Router();

/**
 * @openapi
 * /api/prompt-dna:
 *   get:
 *     tags:
 *       - Personas
 *     summary: List user's PromptDNA profiles
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of PromptDNA profiles
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 dnas:
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
 *                       steeringRules:
 *                         type: string
 *                       consensusBias:
 *                         type: string
 *                       critiqueStyle:
 *                         type: string
 *                       createdAt:
 *                         type: string
 *                         format: date-time
 *       401:
 *         description: Unauthorized
 */
// GET / — list user's PromptDNA profiles
router.get("/", requireAuth, async (req: AuthRequest, res: Response) => {
  const dnas = await prisma.promptDNA.findMany({
    where: { userId: req.userId! },
    orderBy: { createdAt: "desc" },
  });
  res.json({ dnas });
});

/**
 * @openapi
 * /api/prompt-dna:
 *   post:
 *     tags:
 *       - Personas
 *     summary: Create a PromptDNA profile
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
 *               steeringRules:
 *                 type: string
 *               consensusBias:
 *                 type: string
 *                 default: neutral
 *               critiqueStyle:
 *                 type: string
 *                 default: evidence_based
 *     responses:
 *       201:
 *         description: Created PromptDNA
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *       400:
 *         description: Missing required fields
 *       401:
 *         description: Unauthorized
 */
// POST / — create PromptDNA
router.post("/", requireAuth, async (req: AuthRequest, res: Response) => {
  const { name, systemPrompt, steeringRules, consensusBias, critiqueStyle } = req.body;

  if (!name || typeof name !== "string") {
    throw new AppError(400, "Name is required", "DNA_NAME_REQUIRED");
  }
  if (!systemPrompt || typeof systemPrompt !== "string") {
    throw new AppError(400, "System prompt is required", "DNA_PROMPT_REQUIRED");
  }

  const dna = await prisma.promptDNA.create({
    data: {
      userId: req.userId!,
      name: name.trim(),
      systemPrompt: systemPrompt.trim(),
      steeringRules: steeringRules?.trim() || "",
      consensusBias: consensusBias || "neutral",
      critiqueStyle: critiqueStyle || "evidence_based",
    },
  });

  res.status(201).json(dna);
});

/**
 * @openapi
 * /api/prompt-dna/{id}:
 *   put:
 *     tags:
 *       - Personas
 *     summary: Update a PromptDNA profile
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: PromptDNA ID
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
 *               steeringRules:
 *                 type: string
 *               consensusBias:
 *                 type: string
 *               critiqueStyle:
 *                 type: string
 *     responses:
 *       200:
 *         description: Updated PromptDNA
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: PromptDNA not found
 */
// PUT /:id — update PromptDNA
router.put("/:id", requireAuth, async (req: AuthRequest, res: Response) => {
  const dna = await prisma.promptDNA.findFirst({
    where: { id: String(req.params.id as string), userId: req.userId! },
  });
  if (!dna) throw new AppError(404, "PromptDNA not found", "DNA_NOT_FOUND");

  const { name, systemPrompt, steeringRules, consensusBias, critiqueStyle } = req.body;

  const data: Record<string, unknown> = {};
  if (name !== undefined) data.name = name.trim();
  if (systemPrompt !== undefined) data.systemPrompt = systemPrompt.trim();
  if (steeringRules !== undefined) data.steeringRules = steeringRules.trim();
  if (consensusBias !== undefined) data.consensusBias = consensusBias;
  if (critiqueStyle !== undefined) data.critiqueStyle = critiqueStyle;

  const updated = await prisma.promptDNA.update({
    where: { id: dna.id },
    data,
  });

  res.json(updated);
});

/**
 * @openapi
 * /api/prompt-dna/{id}:
 *   delete:
 *     tags:
 *       - Personas
 *     summary: Delete a PromptDNA profile
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: PromptDNA ID
 *     responses:
 *       200:
 *         description: PromptDNA deleted
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
 *         description: PromptDNA not found
 */
// DELETE /:id — delete PromptDNA
router.delete("/:id", requireAuth, async (req: AuthRequest, res: Response) => {
  const dna = await prisma.promptDNA.findFirst({
    where: { id: String(req.params.id as string), userId: req.userId! },
  });
  if (!dna) throw new AppError(404, "PromptDNA not found", "DNA_NOT_FOUND");

  await prisma.promptDNA.delete({ where: { id: dna.id } });
  res.json({ success: true });
});

export default router;
