import { FastifyPluginAsync } from "fastify";
import { randomUUID } from "crypto";
import { fastifyRequireAuth } from "../middleware/fastifyAuth.js";
import { db } from "../lib/drizzle.js";
import { conversations, chats } from "../db/schema/conversations.js";
import {
  sharedConversations,
  sharedWorkflows,
  sharedPrompts,
} from "../db/schema/social.js";
import { workflows } from "../db/schema/workflows.js";
import { prompts, promptVersions } from "../db/schema/prompts.js";
import { eq, and, asc, desc } from "drizzle-orm";
import { AppError } from "../middleware/errorHandler.js";

function parseExpiry(expiresIn?: string): Date | null {
  if (expiresIn === "24h") return new Date(Date.now() + 24 * 60 * 60 * 1000);
  if (expiresIn === "7d") return new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  if (expiresIn === "30d") return new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  return null;
}

const sharePlugin: FastifyPluginAsync = async (fastify) => {
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
  fastify.post("/conversations/:id", { preHandler: fastifyRequireAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const [convo] = await db
      .select()
      .from(conversations)
      .where(and(eq(conversations.id, id), eq(conversations.userId, request.userId!)))
      .limit(1);
    if (!convo) throw new AppError(404, "Conversation not found", "NOT_FOUND");

    const { access, expiresIn } = request.body as { access?: string; expiresIn?: string };
    const expiresAt = parseExpiry(expiresIn);

    const [shared] = await db
      .insert(sharedConversations)
      .values({
        id: randomUUID(),
        conversationId: convo.id,
        ownerId: request.userId!,
        access: access || "read",
        shareToken: randomUUID(),
        expiresAt,
      })
      .onConflictDoUpdate({
        target: sharedConversations.conversationId,
        set: { access: access || "read", expiresAt },
      })
      .returning();

    return { shareToken: shared.shareToken, url: `/share/${shared.shareToken}` };
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
  fastify.delete("/conversations/:id", { preHandler: fastifyRequireAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    await db
      .delete(sharedConversations)
      .where(
        and(
          eq(sharedConversations.conversationId, id),
          eq(sharedConversations.ownerId, request.userId!),
        ),
      );
    return { success: true };
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
  fastify.get("/view/:token", async (request, reply) => {
    const { token } = request.params as { token: string };
    const [shared] = await db
      .select()
      .from(sharedConversations)
      .where(eq(sharedConversations.shareToken, token))
      .limit(1);
    if (!shared) throw new AppError(404, "Share not found", "SHARE_NOT_FOUND");
    if (shared.expiresAt && shared.expiresAt < new Date()) {
      throw new AppError(410, "Share link expired", "SHARE_EXPIRED");
    }

    const [conversation] = await db
      .select()
      .from(conversations)
      .where(eq(conversations.id, shared.conversationId))
      .limit(1);

    const chatList = await db
      .select()
      .from(chats)
      .where(eq(chats.conversationId, shared.conversationId))
      .orderBy(asc(chats.createdAt))
      .limit(100);

    return { conversation, chats: chatList, access: shared.access };
  });

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
  fastify.post("/workflows/:id", { preHandler: fastifyRequireAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const [wf] = await db
      .select()
      .from(workflows)
      .where(and(eq(workflows.id, id), eq(workflows.userId, request.userId!)))
      .limit(1);
    if (!wf) throw new AppError(404, "Workflow not found", "NOT_FOUND");

    const { expiresIn } = request.body as { expiresIn?: string };
    const expiresAt = parseExpiry(expiresIn);

    const [shared] = await db
      .insert(sharedWorkflows)
      .values({
        id: randomUUID(),
        workflowId: wf.id,
        ownerId: request.userId!,
        shareToken: randomUUID(),
        expiresAt,
      })
      .onConflictDoUpdate({
        target: sharedWorkflows.workflowId,
        set: { expiresAt },
      })
      .returning();

    return { shareToken: shared.shareToken };
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
  fastify.get("/workflow/:token", async (request, reply) => {
    const { token } = request.params as { token: string };
    const [shared] = await db
      .select()
      .from(sharedWorkflows)
      .where(eq(sharedWorkflows.shareToken, token))
      .limit(1);
    if (!shared) throw new AppError(404, "Not found", "SHARE_NOT_FOUND");
    if (shared.expiresAt && shared.expiresAt < new Date()) throw new AppError(410, "Expired", "SHARE_EXPIRED");

    const [workflow] = await db
      .select()
      .from(workflows)
      .where(eq(workflows.id, shared.workflowId))
      .limit(1);

    return { workflow };
  });

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
  fastify.post("/prompts/:id", { preHandler: fastifyRequireAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const [prompt] = await db
      .select()
      .from(prompts)
      .where(and(eq(prompts.id, id), eq(prompts.userId, request.userId!)))
      .limit(1);
    if (!prompt) throw new AppError(404, "Prompt not found", "NOT_FOUND");

    const { expiresIn } = request.body as { expiresIn?: string };
    const expiresAt = parseExpiry(expiresIn);

    const [shared] = await db
      .insert(sharedPrompts)
      .values({
        id: randomUUID(),
        promptId: prompt.id,
        ownerId: request.userId!,
        shareToken: randomUUID(),
        expiresAt,
      })
      .onConflictDoUpdate({
        target: sharedPrompts.promptId,
        set: { expiresAt },
      })
      .returning();

    return { shareToken: shared.shareToken };
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
  fastify.get("/prompt/:token", async (request, reply) => {
    const { token } = request.params as { token: string };
    const [shared] = await db
      .select()
      .from(sharedPrompts)
      .where(eq(sharedPrompts.shareToken, token))
      .limit(1);
    if (!shared) throw new AppError(404, "Not found", "SHARE_NOT_FOUND");
    if (shared.expiresAt && shared.expiresAt < new Date()) throw new AppError(410, "Expired", "SHARE_EXPIRED");

    const [prompt] = await db
      .select()
      .from(prompts)
      .where(eq(prompts.id, shared.promptId))
      .limit(1);

    const versions = await db
      .select()
      .from(promptVersions)
      .where(eq(promptVersions.promptId, shared.promptId))
      .orderBy(desc(promptVersions.versionNum))
      .limit(1);

    return { prompt: prompt ? { ...prompt, versions } : null };
  });
};

export default sharePlugin;
