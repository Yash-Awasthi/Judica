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

/**
 * @openapi
 * /api/artifacts:
 *   get:
 *     tags:
 *       - Sandbox
 *     summary: List user artifacts
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: conversation_id
 *         schema:
 *           type: string
 *         description: Filter by conversation ID
 *       - in: query
 *         name: type
 *         schema:
 *           type: string
 *         description: Filter by artifact type
 *     responses:
 *       200:
 *         description: List of artifacts
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 artifacts:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id:
 *                         type: string
 *                       name:
 *                         type: string
 *                       type:
 *                         type: string
 *                       language:
 *                         type: string
 *                         nullable: true
 *                       conversationId:
 *                         type: string
 *                       createdAt:
 *                         type: string
 *                         format: date-time
 *                       updatedAt:
 *                         type: string
 *                         format: date-time
 *       401:
 *         description: Unauthorized
 */
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

/**
 * @openapi
 * /api/artifacts/{id}:
 *   get:
 *     tags:
 *       - Sandbox
 *     summary: Get an artifact by ID
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Artifact ID
 *     responses:
 *       200:
 *         description: Artifact details
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Artifact not found
 */
// GET /api/artifacts/:id — get artifact
router.get("/:id", requireAuth, async (req: AuthRequest, res: Response) => {
  const artifact = await prisma.artifact.findFirst({
    where: { id: req.params.id, userId: req.userId! },
  });
  if (!artifact) throw new AppError(404, "Artifact not found", "ARTIFACT_NOT_FOUND");
  res.json(artifact);
});

/**
 * @openapi
 * /api/artifacts/{id}:
 *   put:
 *     tags:
 *       - Sandbox
 *     summary: Update an artifact
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Artifact ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *               content:
 *                 type: string
 *     responses:
 *       200:
 *         description: Updated artifact
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Artifact not found
 */
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

/**
 * @openapi
 * /api/artifacts/{id}:
 *   delete:
 *     tags:
 *       - Sandbox
 *     summary: Delete an artifact
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Artifact ID
 *     responses:
 *       200:
 *         description: Artifact deleted
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
 *         description: Artifact not found
 */
// DELETE /api/artifacts/:id — delete
router.delete("/:id", requireAuth, async (req: AuthRequest, res: Response) => {
  const artifact = await prisma.artifact.findFirst({
    where: { id: req.params.id, userId: req.userId! },
  });
  if (!artifact) throw new AppError(404, "Artifact not found", "ARTIFACT_NOT_FOUND");

  await prisma.artifact.delete({ where: { id: artifact.id } });
  res.json({ success: true });
});

/**
 * @openapi
 * /api/artifacts/{id}/download:
 *   get:
 *     tags:
 *       - Sandbox
 *     summary: Download an artifact as a file
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Artifact ID
 *     responses:
 *       200:
 *         description: File download
 *         content:
 *           text/plain:
 *             schema:
 *               type: string
 *               format: binary
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Artifact not found
 */
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
