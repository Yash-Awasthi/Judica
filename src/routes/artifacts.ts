import { Router, Response } from "express";
import { requireAuth } from "../middleware/auth.js";
import prisma from "../lib/db.js";
import { AuthRequest } from "../types/index.js";
import { AppError } from "../middleware/errorHandler.js";

const router = Router();

const MIME_TYPES: Record<string, string> = {
  code: "text/plain",
  markdown: "text/markdown",
  html: "text/html",
  json: "application/json",
  csv: "text/csv",
};

const EXTENSIONS: Record<string, string> = {
  code: "txt",
  markdown: "md",
  html: "html",
  json: "json",
  csv: "csv",
};

const LANG_EXTENSIONS: Record<string, string> = {
  javascript: "js",
  typescript: "ts",
  python: "py",
  ruby: "rb",
  go: "go",
  rust: "rs",
  java: "java",
  "c++": "cpp",
  c: "c",
  bash: "sh",
  sql: "sql",
  html: "html",
  css: "css",
};

// GET /api/artifacts — list user's artifacts
router.get("/", requireAuth, async (req: AuthRequest, res: Response) => {
  const { conversation_id, type } = req.query;

  const where: Record<string, unknown> = { userId: req.userId! };
  if (conversation_id) where.conversationId = conversation_id as string;
  if (type) where.type = type as string;

  const artifacts = await prisma.artifact.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: 50,
    select: {
      id: true,
      name: true,
      type: true,
      language: true,
      conversationId: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  res.json({ artifacts });
});

// GET /api/artifacts/:id — get artifact
router.get("/:id", requireAuth, async (req: AuthRequest, res: Response) => {
  const artifact = await prisma.artifact.findFirst({
    where: { id: req.params.id, userId: req.userId! },
  });
  if (!artifact) throw new AppError(404, "Artifact not found", "ARTIFACT_NOT_FOUND");
  res.json(artifact);
});

// PUT /api/artifacts/:id — update artifact
router.put("/:id", requireAuth, async (req: AuthRequest, res: Response) => {
  const artifact = await prisma.artifact.findFirst({
    where: { id: req.params.id, userId: req.userId! },
  });
  if (!artifact) throw new AppError(404, "Artifact not found", "ARTIFACT_NOT_FOUND");

  const updates: Record<string, unknown> = {};
  if (req.body.name !== undefined) updates.name = req.body.name;
  if (req.body.content !== undefined) updates.content = req.body.content;

  const updated = await prisma.artifact.update({
    where: { id: artifact.id },
    data: updates,
  });

  res.json(updated);
});

// DELETE /api/artifacts/:id — delete
router.delete("/:id", requireAuth, async (req: AuthRequest, res: Response) => {
  const artifact = await prisma.artifact.findFirst({
    where: { id: req.params.id, userId: req.userId! },
  });
  if (!artifact) throw new AppError(404, "Artifact not found", "ARTIFACT_NOT_FOUND");

  await prisma.artifact.delete({ where: { id: artifact.id } });
  res.json({ success: true });
});

// GET /api/artifacts/:id/download — download as file
router.get("/:id/download", requireAuth, async (req: AuthRequest, res: Response) => {
  const artifact = await prisma.artifact.findFirst({
    where: { id: req.params.id, userId: req.userId! },
  });
  if (!artifact) throw new AppError(404, "Artifact not found", "ARTIFACT_NOT_FOUND");

  const mimeType = MIME_TYPES[artifact.type] || "text/plain";
  const ext = artifact.type === "code" && artifact.language
    ? (LANG_EXTENSIONS[artifact.language] || "txt")
    : (EXTENSIONS[artifact.type] || "txt");

  const safeName = artifact.name.replace(/[^a-zA-Z0-9_.-]/g, "_");
  const filename = `${safeName}.${ext}`;

  res.setHeader("Content-Type", mimeType);
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.send(artifact.content);
});

export default router;
