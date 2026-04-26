/**
 * Conversation Branches Routes — Phase 1.7
 *
 * Loom (MIT, socketteer/loom) tree-based conversation branching.
 * A branch forks a conversation at any message, creating a new conversation
 * that shares history up to the branch point.
 *
 * POST /conversations/:conversationId/branch — fork a conversation
 * GET  /conversations/:conversationId/branches — list all branches
 */

import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { db } from "../lib/drizzle.js";
import { conversationBranches } from "../db/schema/branches.js";
import { conversations } from "../db/schema/conversations.js";
import { chats } from "../db/schema/conversations.js";
import { eq, and, asc } from "drizzle-orm";
import { fastifyRequireAuth } from "../middleware/fastifyAuth.js";
import { AppError } from "../middleware/errorHandler.js";
import { randomUUID } from "crypto";
const branchSchema = z.object({
  branchPointMessageId: z.string().optional(),
  title: z.string().max(100).optional(),
});

const branchesPlugin: FastifyPluginAsync = async (fastify) => {
  /**
   * POST /conversations/:conversationId/branch
   * Fork a conversation at a given message (Loom node fork).
   * Creates a new conversation pre-populated with messages up to the branch point.
   */
  fastify.post(
    "/conversations/:conversationId/branch",
    { preHandler: fastifyRequireAuth },
    async (request, reply) => {
      const { conversationId } = request.params as { conversationId: string };
      const userId = request.userId!;

      const parsed = branchSchema.safeParse(request.body);
      if (!parsed.success) {
        throw new AppError(400, "Invalid branch request", "VALIDATION_ERROR");
      }
      const { branchPointMessageId, title } = parsed.data;

      // Verify the parent conversation belongs to this user
      const [parent] = await db
        .select()
        .from(conversations)
        .where(and(eq(conversations.id, conversationId), eq(conversations.userId, userId)))
        .limit(1);

      if (!parent) throw new AppError(404, "Conversation not found", "NOT_FOUND");

      // Get messages up to the branch point (or all messages if no branch point)
      const allMessages = await db
        .select()
        .from(chats)
        .where(eq(chats.conversationId, conversationId))
        .orderBy(asc(chats.id));

      let messagesToCopy = allMessages;
      if (branchPointMessageId) {
        const targetId = parseInt(branchPointMessageId, 10);
        const idx = allMessages.findIndex(m => m.id === targetId);
        if (idx !== -1) messagesToCopy = allMessages.slice(0, idx + 1);
      }

      // Create the new (branch) conversation
      const newConversationId = randomUUID();
      const [newConvo] = await db
        .insert(conversations)
        .values({
          id: newConversationId,
          userId,
          title: title ?? `Branch of: ${parent.title ?? conversationId.slice(0, 8)}`,
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .returning();

      // Copy chat records into the new conversation
      if (messagesToCopy.length > 0) {
        await db.insert(chats).values(
          messagesToCopy.map(m => ({
            conversationId: newConversationId,
            userId,
            question: m.question,
            verdict: m.verdict,
            opinions: m.opinions,
            createdAt: new Date(),
            cacheHit: false,
          })),
        );
      }

      // Record the branch metadata
      const [branch] = await db
        .insert(conversationBranches)
        .values({
          parentConversationId: conversationId,
          branchPointMessageId: branchPointMessageId ?? null,
          title: title ?? null,
          userId,
        })
        .returning();

      reply.code(201);
      return {
        branch,
        newConversationId: newConvo.id,
        messagesCopied: messagesToCopy.length,
      };
    },
  );

  /**
   * GET /conversations/:conversationId/branches
   * List all branches forked from this conversation.
   */
  fastify.get(
    "/conversations/:conversationId/branches",
    { preHandler: fastifyRequireAuth },
    async (request, _reply) => {
      const { conversationId } = request.params as { conversationId: string };
      const userId = request.userId!;

      const branches = await db
        .select()
        .from(conversationBranches)
        .where(
          and(
            eq(conversationBranches.parentConversationId, conversationId),
            eq(conversationBranches.userId, userId),
          ),
        );

      return { branches };
    },
  );
};

export default branchesPlugin;
