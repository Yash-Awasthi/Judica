import { Router, Response } from "express";
import { requireAuth } from "../middleware/auth.js";
import prisma from "../lib/db.js";
import type { AuthRequest } from "../types/index.js";
import { AppError } from "../middleware/errorHandler.js";
import { BUILT_IN_PERSONAS } from "../agents/personas.js";

const router = Router();

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

// PUT /:id — update custom persona
router.put("/:id", requireAuth, async (req: AuthRequest, res: Response) => {
  const persona = await prisma.customPersona.findFirst({
    where: { id: String(req.params.id), userId: req.userId! },
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

// DELETE /:id — delete custom persona
router.delete("/:id", requireAuth, async (req: AuthRequest, res: Response) => {
  const persona = await prisma.customPersona.findFirst({
    where: { id: String(req.params.id), userId: req.userId! },
  });
  if (!persona) throw new AppError(404, "Persona not found", "PERSONA_NOT_FOUND");

  await prisma.customPersona.delete({ where: { id: persona.id } });
  res.json({ success: true });
});

export default router;
