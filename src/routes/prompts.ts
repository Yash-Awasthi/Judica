import { Router, Response } from "express";
import { requireAuth } from "../middleware/auth.js";
import prisma from "../lib/db.js";
import type { AuthRequest } from "../types/index.js";
import { AppError } from "../middleware/errorHandler.js";
import { routeAndCollect } from "../router/index.js";
import logger from "../lib/logger.js";

const router = Router();

// GET / — list user's prompts
router.get("/", requireAuth, async (req: AuthRequest, res: Response) => {
  const prompts = await prisma.prompt.findMany({
    where: { userId: req.userId! },
    orderBy: { createdAt: "desc" },
    include: {
      versions: {
        orderBy: { versionNum: "desc" },
        take: 1,
        select: { id: true, versionNum: true, createdAt: true },
      },
    },
  });

  res.json({ prompts });
});

// POST / — create prompt + first version
router.post("/", requireAuth, async (req: AuthRequest, res: Response) => {
  const { name, description, content, model, temperature } = req.body;

  if (!name || typeof name !== "string" || name.trim().length === 0) {
    throw new AppError(400, "Name is required", "PROMPT_NAME_REQUIRED");
  }
  if (!content || typeof content !== "string" || content.trim().length === 0) {
    throw new AppError(400, "Content is required", "PROMPT_CONTENT_REQUIRED");
  }

  const prompt = await prisma.prompt.create({
    data: {
      userId: req.userId!,
      name: name.trim(),
      description: description?.trim() || null,
      versions: {
        create: {
          versionNum: 1,
          content: content.trim(),
          model: model || null,
          temperature: temperature ?? null,
        },
      },
    },
    include: {
      versions: true,
    },
  });

  res.status(201).json(prompt);
});

// GET /:id — get prompt detail with latest version
router.get("/:id", requireAuth, async (req: AuthRequest, res: Response) => {
  const prompt = await prisma.prompt.findFirst({
    where: { id: String(req.params.id), userId: req.userId! },
    include: {
      versions: {
        orderBy: { versionNum: "desc" },
        take: 1,
      },
    },
  });
  if (!prompt) throw new AppError(404, "Prompt not found", "PROMPT_NOT_FOUND");

  res.json(prompt);
});

// DELETE /:id — delete prompt (cascades versions)
router.delete("/:id", requireAuth, async (req: AuthRequest, res: Response) => {
  const prompt = await prisma.prompt.findFirst({
    where: { id: String(req.params.id), userId: req.userId! },
  });
  if (!prompt) throw new AppError(404, "Prompt not found", "PROMPT_NOT_FOUND");

  await prisma.prompt.delete({ where: { id: prompt.id } });
  res.json({ success: true });
});

// GET /:id/versions — list all versions for prompt
router.get("/:id/versions", requireAuth, async (req: AuthRequest, res: Response) => {
  const prompt = await prisma.prompt.findFirst({
    where: { id: String(req.params.id), userId: req.userId! },
  });
  if (!prompt) throw new AppError(404, "Prompt not found", "PROMPT_NOT_FOUND");

  const versions = await prisma.promptVersion.findMany({
    where: { promptId: prompt.id },
    orderBy: { versionNum: "desc" },
  });

  res.json({ versions });
});

// POST /:id/versions — create new version
router.post("/:id/versions", requireAuth, async (req: AuthRequest, res: Response) => {
  const prompt = await prisma.prompt.findFirst({
    where: { id: String(req.params.id), userId: req.userId! },
  });
  if (!prompt) throw new AppError(404, "Prompt not found", "PROMPT_NOT_FOUND");

  const { content, model, temperature, notes } = req.body;
  if (!content || typeof content !== "string" || content.trim().length === 0) {
    throw new AppError(400, "Content is required", "VERSION_CONTENT_REQUIRED");
  }

  // Get current max versionNum
  const latest = await prisma.promptVersion.findFirst({
    where: { promptId: prompt.id },
    orderBy: { versionNum: "desc" },
    select: { versionNum: true },
  });

  const nextVersion = (latest?.versionNum ?? 0) + 1;

  const version = await prisma.promptVersion.create({
    data: {
      promptId: prompt.id,
      versionNum: nextVersion,
      content: content.trim(),
      model: model || null,
      temperature: temperature ?? null,
      notes: notes?.trim() || null,
    },
  });

  res.status(201).json(version);
});

// GET /:id/versions/:versionNum — get specific version
router.get("/:id/versions/:versionNum", requireAuth, async (req: AuthRequest, res: Response) => {
  const prompt = await prisma.prompt.findFirst({
    where: { id: String(req.params.id), userId: req.userId! },
  });
  if (!prompt) throw new AppError(404, "Prompt not found", "PROMPT_NOT_FOUND");

  const versionNum = parseInt(String(req.params.versionNum), 10);
  if (isNaN(versionNum)) {
    throw new AppError(400, "Invalid version number", "INVALID_VERSION_NUM");
  }

  const version = await prisma.promptVersion.findUnique({
    where: {
      promptId_versionNum: { promptId: prompt.id, versionNum },
    },
  });
  if (!version) throw new AppError(404, "Version not found", "VERSION_NOT_FOUND");

  res.json(version);
});

// POST /test — test a prompt against LLM
router.post("/test", requireAuth, async (req: AuthRequest, res: Response) => {
  const { content, model, temperature, test_input } = req.body;

  if (!content || typeof content !== "string" || content.trim().length === 0) {
    throw new AppError(400, "Content is required", "TEST_CONTENT_REQUIRED");
  }

  // Replace {{input}} placeholder with test_input if provided
  let resolvedContent = content;
  if (test_input) {
    resolvedContent = resolvedContent.replace(/\{\{input\}\}/g, test_input);
  }

  const startTime = Date.now();

  const result = await routeAndCollect(
    {
      model: model || "auto",
      messages: [{ role: "user", content: resolvedContent }],
      temperature: temperature ?? undefined,
    },
    { preferredModel: model || undefined },
  );

  const latencyMs = Date.now() - startTime;

  res.json({
    response: result.text,
    latency_ms: latencyMs,
    usage: result.usage,
  });
});

export default router;
