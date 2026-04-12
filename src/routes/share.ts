import { Router, Response, Request } from "express";
import { requireAuth } from "../middleware/auth.js";
import prisma from "../lib/db.js";
import type { AuthRequest } from "../types/index.js";
import { AppError } from "../middleware/errorHandler.js";

const router = Router();

// ─── Conversation Sharing ─────────────────────────────────────────────────

/**
 * @openapi
 * /share/conversations/{id}:
 *   post:
 *     summary: Share a conversation
 *     description: Creates or updates a share link for a conversation owned by the authenticated user.
 *     tags:
 *       - Sharing
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: The conversation ID
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               access:
 *                 type: string
 *                 enum: [read, write]
 *                 default: read
 *                 description: Access level for the share link
 *               expiresIn:
 *                 type: string
 *                 enum: [24h, 7d, 30d]
 *                 description: Expiration duration for the share link
 *     responses:
 *       200:
 *         description: Share link created or updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 shareToken:
 *                   type: string
 *                 url:
 *                   type: string
 *       404:
 *         description: Conversation not found
 */
// POST /conversations/:id — share a conversation
router.post("/conversations/:id", requireAuth, async (req: AuthRequest, res: Response) => {
  const convo = await prisma.conversation.findFirst({
    where: { id: String(req.params.id), userId: req.userId! },
  });
  if (!convo) throw new AppError(404, "Conversation not found", "NOT_FOUND");

  const { access, expiresIn } = req.body;
  let expiresAt: Date | null = null;
  if (expiresIn === "24h") expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
  else if (expiresIn === "7d") expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  else if (expiresIn === "30d") expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

  const shared = await prisma.sharedConversation.upsert({
    where: { conversationId: convo.id },
    create: {
      conversationId: convo.id,
      ownerId: req.userId!,
      access: access || "read",
      expiresAt,
    },
    update: { access: access || "read", expiresAt },
  });

  res.json({ shareToken: shared.shareToken, url: `/share/${shared.shareToken}` });
});

/**
 * @openapi
 * /share/conversations/{id}:
 *   delete:
 *     summary: Unshare a conversation
 *     description: Removes the share link for a conversation owned by the authenticated user.
 *     tags:
 *       - Sharing
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: The conversation ID
 *     responses:
 *       200:
 *         description: Conversation unshared successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 */
// DELETE /conversations/:id — unshare
router.delete("/conversations/:id", requireAuth, async (req: AuthRequest, res: Response) => {
  await prisma.sharedConversation.deleteMany({
    where: { conversationId: String(req.params.id), ownerId: req.userId! },
  });
  res.json({ success: true });
});

/**
 * @openapi
 * /share/view/{token}:
 *   get:
 *     summary: View a shared conversation
 *     description: Retrieves a shared conversation and its chats by share token. No authentication required.
 *     tags:
 *       - Sharing
 *     parameters:
 *       - in: path
 *         name: token
 *         required: true
 *         schema:
 *           type: string
 *         description: The share token
 *     responses:
 *       200:
 *         description: Shared conversation retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 conversation:
 *                   type: object
 *                 chats:
 *                   type: array
 *                   items:
 *                     type: object
 *                 access:
 *                   type: string
 *       404:
 *         description: Share not found
 *       410:
 *         description: Share link expired
 */
// GET /view/:token — public view (no auth)
router.get("/view/:token", async (req: Request, res: Response) => {
  const shared = await prisma.sharedConversation.findUnique({
    where: { shareToken: String(req.params.token) },
  });
  if (!shared) throw new AppError(404, "Share not found", "SHARE_NOT_FOUND");
  if (shared.expiresAt && shared.expiresAt < new Date()) {
    throw new AppError(410, "Share link expired", "SHARE_EXPIRED");
  }

  const conversation = await prisma.conversation.findUnique({
    where: { id: shared.conversationId },
  });
  const chats = await prisma.chat.findMany({
    where: { conversationId: shared.conversationId },
    orderBy: { createdAt: "asc" },
    take: 100,
  });

  res.json({ conversation, chats, access: shared.access });
});

// ─── Workflow Sharing ─────────────────────────────────────────────────────

/**
 * @openapi
 * /share/workflows/{id}:
 *   post:
 *     summary: Share a workflow
 *     description: Creates or updates a share link for a workflow owned by the authenticated user.
 *     tags:
 *       - Sharing
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: The workflow ID
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               expiresIn:
 *                 type: string
 *                 enum: [24h, 7d, 30d]
 *                 description: Expiration duration for the share link
 *     responses:
 *       200:
 *         description: Workflow share link created or updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 shareToken:
 *                   type: string
 *       404:
 *         description: Workflow not found
 */
router.post("/workflows/:id", requireAuth, async (req: AuthRequest, res: Response) => {
  const wf = await prisma.workflow.findFirst({
    where: { id: String(req.params.id), userId: req.userId! },
  });
  if (!wf) throw new AppError(404, "Workflow not found", "NOT_FOUND");

  const { expiresIn } = req.body;
  let expiresAt: Date | null = null;
  if (expiresIn === "24h") expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
  else if (expiresIn === "7d") expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  else if (expiresIn === "30d") expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

  const shared = await prisma.sharedWorkflow.upsert({
    where: { workflowId: wf.id },
    create: { workflowId: wf.id, ownerId: req.userId!, expiresAt },
    update: { expiresAt },
  });

  res.json({ shareToken: shared.shareToken });
});

/**
 * @openapi
 * /share/workflow/{token}:
 *   get:
 *     summary: View a shared workflow
 *     description: Retrieves a shared workflow by share token. No authentication required.
 *     tags:
 *       - Sharing
 *     parameters:
 *       - in: path
 *         name: token
 *         required: true
 *         schema:
 *           type: string
 *         description: The share token
 *     responses:
 *       200:
 *         description: Shared workflow retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 workflow:
 *                   type: object
 *       404:
 *         description: Share not found
 *       410:
 *         description: Share link expired
 */
router.get("/workflow/:token", async (req: Request, res: Response) => {
  const shared = await prisma.sharedWorkflow.findUnique({
    where: { shareToken: String(req.params.token) },
  });
  if (!shared) throw new AppError(404, "Not found", "SHARE_NOT_FOUND");
  if (shared.expiresAt && shared.expiresAt < new Date()) throw new AppError(410, "Expired", "SHARE_EXPIRED");

  const workflow = await prisma.workflow.findUnique({ where: { id: shared.workflowId } });
  res.json({ workflow });
});

// ─── Prompt Sharing ───────────────────────────────────────────────────────

/**
 * @openapi
 * /share/prompts/{id}:
 *   post:
 *     summary: Share a prompt
 *     description: Creates or updates a share link for a prompt owned by the authenticated user.
 *     tags:
 *       - Sharing
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: The prompt ID
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               expiresIn:
 *                 type: string
 *                 enum: [24h, 7d, 30d]
 *                 description: Expiration duration for the share link
 *     responses:
 *       200:
 *         description: Prompt share link created or updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 shareToken:
 *                   type: string
 *       404:
 *         description: Prompt not found
 */
router.post("/prompts/:id", requireAuth, async (req: AuthRequest, res: Response) => {
  const prompt = await prisma.prompt.findFirst({
    where: { id: String(req.params.id), userId: req.userId! },
  });
  if (!prompt) throw new AppError(404, "Prompt not found", "NOT_FOUND");

  const { expiresIn } = req.body;
  let expiresAt: Date | null = null;
  if (expiresIn === "24h") expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
  else if (expiresIn === "7d") expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  else if (expiresIn === "30d") expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

  const shared = await prisma.sharedPrompt.upsert({
    where: { promptId: prompt.id },
    create: { promptId: prompt.id, ownerId: req.userId!, expiresAt },
    update: { expiresAt },
  });

  res.json({ shareToken: shared.shareToken });
});

/**
 * @openapi
 * /share/prompt/{token}:
 *   get:
 *     summary: View a shared prompt
 *     description: Retrieves a shared prompt and its latest version by share token. No authentication required.
 *     tags:
 *       - Sharing
 *     parameters:
 *       - in: path
 *         name: token
 *         required: true
 *         schema:
 *           type: string
 *         description: The share token
 *     responses:
 *       200:
 *         description: Shared prompt retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 prompt:
 *                   type: object
 *       404:
 *         description: Share not found
 *       410:
 *         description: Share link expired
 */
router.get("/prompt/:token", async (req: Request, res: Response) => {
  const shared = await prisma.sharedPrompt.findUnique({
    where: { shareToken: String(req.params.token) },
  });
  if (!shared) throw new AppError(404, "Not found", "SHARE_NOT_FOUND");
  if (shared.expiresAt && shared.expiresAt < new Date()) throw new AppError(410, "Expired", "SHARE_EXPIRED");

  const prompt = await prisma.prompt.findUnique({
    where: { id: shared.promptId },
    include: { versions: { orderBy: { versionNum: "desc" }, take: 1 } },
  });
  res.json({ prompt });
});

export default router;
