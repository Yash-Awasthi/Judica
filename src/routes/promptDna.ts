import { Router, Response } from "express";
import { requireAuth } from "../middleware/auth.js";
import prisma from "../lib/db.js";
import type { AuthRequest } from "../types/index.js";
import { AppError } from "../middleware/errorHandler.js";

const router = Router();

// GET / — list user's PromptDNA profiles
router.get("/", requireAuth, async (req: AuthRequest, res: Response) => {
  const dnas = await prisma.promptDNA.findMany({
    where: { userId: req.userId! },
    orderBy: { createdAt: "desc" },
  });
  res.json({ dnas });
});

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

// PUT /:id — update PromptDNA
router.put("/:id", requireAuth, async (req: AuthRequest, res: Response) => {
  const dna = await prisma.promptDNA.findFirst({
    where: { id: String(req.params.id), userId: req.userId! },
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

// DELETE /:id — delete PromptDNA
router.delete("/:id", requireAuth, async (req: AuthRequest, res: Response) => {
  const dna = await prisma.promptDNA.findFirst({
    where: { id: String(req.params.id), userId: req.userId! },
  });
  if (!dna) throw new AppError(404, "PromptDNA not found", "DNA_NOT_FOUND");

  await prisma.promptDNA.delete({ where: { id: dna.id } });
  res.json({ success: true });
});

export default router;
