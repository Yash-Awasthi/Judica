import { Router } from "express";
import type { Response } from "express";
import type { AuthRequest } from "../types/index.js";
import prisma from "../lib/db.js";
import { searchRepo } from "../services/repoSearch.service.js";
import { repoQueue } from "../queue/queues.js";
import logger from "../lib/logger.js";

const router = Router();

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

// GET /:id/status — return indexed status
router.get("/:id/status", async (req: AuthRequest, res: Response) => {
  const userId = String(req.userId);
  const repoRecord = await prisma.codeRepository.findFirst({
    where: { id: req.params.id, userId },
    select: { indexed: true, fileCount: true },
  });

  if (!repoRecord) {
    res.status(404).json({ error: "Repository not found" });
    return;
  }

  res.json(repoRecord);
});

// POST /:id/search — search repo files
router.post("/:id/search", async (req: AuthRequest, res: Response) => {
  const userId = String(req.userId);
  const { query } = req.body as { query?: string };

  if (!query) {
    res.status(400).json({ error: "query is required" });
    return;
  }

  const repoRecord = await prisma.codeRepository.findFirst({
    where: { id: req.params.id, userId },
  });

  if (!repoRecord) {
    res.status(404).json({ error: "Repository not found" });
    return;
  }

  const results = await searchRepo(req.params.id, query);
  res.json({ data: results });
});

// DELETE /:id — delete repo + cascade files
router.delete("/:id", async (req: AuthRequest, res: Response) => {
  const userId = String(req.userId);

  const repoRecord = await prisma.codeRepository.findFirst({
    where: { id: req.params.id, userId },
  });

  if (!repoRecord) {
    res.status(404).json({ error: "Repository not found" });
    return;
  }

  await prisma.codeRepository.delete({ where: { id: req.params.id } });
  res.json({ message: "Repository deleted" });
});

export default router;
