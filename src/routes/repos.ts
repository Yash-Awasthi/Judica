import { Router } from "express";
import type { Response } from "express";
import type { AuthRequest } from "../types/index.js";
import prisma from "../lib/db.js";
import { searchRepo } from "../services/repoSearch.service.js";
import { repoQueue } from "../queue/queues.js";
import logger from "../lib/logger.js";

const router = Router();

/**
 * @openapi
 * /api/repos:
 *   get:
 *     tags:
 *       - Repositories
 *     summary: List user's repositories
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of repositories
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id:
 *                         type: string
 *                       source:
 *                         type: string
 *                       repoUrl:
 *                         type: string
 *                       name:
 *                         type: string
 *                       indexed:
 *                         type: boolean
 *                       fileCount:
 *                         type: integer
 *                       createdAt:
 *                         type: string
 *                         format: date-time
 *       401:
 *         description: Unauthorized
 */
// GET / — list user's repos
router.get("/", async (req: AuthRequest, res: Response) => {
  const userId = String(req.userId);
  const repos = await prisma.codeRepository.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      source: true,
      repoUrl: true,
      name: true,
      indexed: true,
      fileCount: true,
      createdAt: true,
    },
  });
  res.json({ data: repos });
});

/**
 * @openapi
 * /api/repos/github:
 *   post:
 *     tags:
 *       - Repositories
 *     summary: Start GitHub repository ingestion
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - owner
 *               - repo
 *             properties:
 *               owner:
 *                 type: string
 *                 description: GitHub repository owner
 *               repo:
 *                 type: string
 *                 description: GitHub repository name
 *     responses:
 *       202:
 *         description: Ingestion queued
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                 owner:
 *                   type: string
 *                 repo:
 *                   type: string
 *       400:
 *         description: Missing owner or repo
 *       401:
 *         description: Unauthorized
 */
// POST /github — start ingestion
router.post("/github", async (req: AuthRequest, res: Response) => {
  const userId = String(req.userId);
  const { owner, repo } = req.body as { owner?: string; repo?: string };

  if (!owner || !repo) {
    res.status(400).json({ error: "owner and repo are required" });
    return;
  }

  // Queue the ingestion via BullMQ
  await repoQueue.add("ingest", { userId, owner: owner.trim(), repo: repo.trim() });

  res.status(202).json({ message: "Ingestion queued", owner, repo });
});

/**
 * @openapi
 * /api/repos/{id}/status:
 *   get:
 *     tags:
 *       - Repositories
 *     summary: Get repository indexing status
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Repository ID
 *     responses:
 *       200:
 *         description: Repository status
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 indexed:
 *                   type: boolean
 *                 fileCount:
 *                   type: integer
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Repository not found
 */
// GET /:id/status — return indexed status
router.get("/:id/status", async (req: AuthRequest, res: Response) => {
  const userId = String(req.userId);
  const repoRecord = await prisma.codeRepository.findFirst({
    where: { id: req.params.id as string, userId },
    select: { indexed: true, fileCount: true },
  });

  if (!repoRecord) {
    res.status(404).json({ error: "Repository not found" });
    return;
  }

  res.json(repoRecord);
});

/**
 * @openapi
 * /api/repos/{id}/search:
 *   post:
 *     tags:
 *       - Repositories
 *     summary: Search repository files
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Repository ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - query
 *             properties:
 *               query:
 *                 type: string
 *                 description: Search query
 *     responses:
 *       200:
 *         description: Search results
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *       400:
 *         description: Missing query
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Repository not found
 */
// POST /:id/search — search repo files
router.post("/:id/search", async (req: AuthRequest, res: Response) => {
  const userId = String(req.userId);
  const { query } = req.body as { query?: string };

  if (!query) {
    res.status(400).json({ error: "query is required" });
    return;
  }

  const repoRecord = await prisma.codeRepository.findFirst({
    where: { id: req.params.id as string, userId },
  });

  if (!repoRecord) {
    res.status(404).json({ error: "Repository not found" });
    return;
  }

  const results = await searchRepo(req.params.id as string, query);
  res.json({ data: results });
});

/**
 * @openapi
 * /api/repos/{id}:
 *   delete:
 *     tags:
 *       - Repositories
 *     summary: Delete a repository and cascade files
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Repository ID
 *     responses:
 *       200:
 *         description: Repository deleted
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Repository not found
 */
// DELETE /:id — delete repo + cascade files
router.delete("/:id", async (req: AuthRequest, res: Response) => {
  const userId = String(req.userId);

  const repoRecord = await prisma.codeRepository.findFirst({
    where: { id: req.params.id as string, userId },
  });

  if (!repoRecord) {
    res.status(404).json({ error: "Repository not found" });
    return;
  }

  await prisma.codeRepository.delete({ where: { id: req.params.id as string } });
  res.json({ message: "Repository deleted" });
});

export default router;
