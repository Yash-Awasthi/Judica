import type { FastifyPluginAsync } from "fastify";
import fastifyRateLimit from "@fastify/rate-limit";
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

const VALID_ACCESS_TYPES = ["read", "write"] as const;
const VALID_EXPIRES_IN = ["24h", "7d", "30d"] as const;

function validateAccess(access?: string): "read" | "write" {
  if (access === undefined) return "read";
  if (!VALID_ACCESS_TYPES.includes(access as any)) {
    throw new AppError(400, "Invalid access type. Must be 'read' or 'write'");
  }
  return access as "read" | "write";
}

function validateExpiresIn(expiresIn?: string): string | undefined {
  if (expiresIn === undefined) return undefined;
  if (!VALID_EXPIRES_IN.includes(expiresIn as any)) {
    throw new AppError(400, "Invalid expiresIn value. Must be '24h', '7d', or '30d'");
  }
  return expiresIn;
}

function parseExpiry(expiresIn?: string): Date | null {
  if (expiresIn === "24h") return new Date(Date.now() + 24 * 60 * 60 * 1000);
  if (expiresIn === "7d") return new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  if (expiresIn === "30d") return new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  return null;
}

const sharePlugin: FastifyPluginAsync = async (fastify) => {
  await fastify.register(fastifyRateLimit, { max: 30, timeWindow: "1 minute" });

    // POST /conversations/:id — share a conversation
  fastify.post("/conversations/:id", { preHandler: fastifyRequireAuth }, async (request, _reply) => {
    const { id } = request.params as { id: string };
    const [convo] = await db
      .select()
      .from(conversations)
      .where(and(eq(conversations.id, id), eq(conversations.userId, request.userId!)))
      .limit(1);
    if (!convo) throw new AppError(404, "Conversation not found", "NOT_FOUND");

    const { access: rawAccess, expiresIn: rawExpiresIn } = request.body as { access?: string; expiresIn?: string };
    const validatedAccess = validateAccess(rawAccess);
    const validatedExpiresIn = validateExpiresIn(rawExpiresIn);
    const expiresAt = parseExpiry(validatedExpiresIn);

    const [shared] = await db
      .insert(sharedConversations)
      .values({
        id: randomUUID(),
        conversationId: convo.id,
        ownerId: request.userId!,
        access: validatedAccess,
        shareToken: randomUUID(),
        expiresAt,
      })
      .onConflictDoUpdate({
        target: sharedConversations.conversationId,
        set: { access: validatedAccess, expiresAt },
      })
      .returning();

    return { shareToken: shared.shareToken, url: `/share/${shared.shareToken}` };
  });

    // DELETE /conversations/:id — unshare
  fastify.delete("/conversations/:id", { preHandler: fastifyRequireAuth }, async (request, _reply) => {
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

    // GET /view/:token — public view (no auth)
  fastify.get("/view/:token", async (request, _reply) => {
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

    fastify.post("/workflows/:id", { preHandler: fastifyRequireAuth }, async (request, _reply) => {
    const { id } = request.params as { id: string };
    const [wf] = await db
      .select()
      .from(workflows)
      .where(and(eq(workflows.id, id), eq(workflows.userId, request.userId!)))
      .limit(1);
    if (!wf) throw new AppError(404, "Workflow not found", "NOT_FOUND");

    const { expiresIn: rawExpiresIn } = request.body as { expiresIn?: string };
    const validatedExpiresIn = validateExpiresIn(rawExpiresIn);
    const expiresAt = parseExpiry(validatedExpiresIn);

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

    fastify.get("/workflow/:token", async (request, _reply) => {
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

    fastify.post("/prompts/:id", { preHandler: fastifyRequireAuth }, async (request, _reply) => {
    const { id } = request.params as { id: string };
    const [prompt] = await db
      .select()
      .from(prompts)
      .where(and(eq(prompts.id, id), eq(prompts.userId, request.userId!)))
      .limit(1);
    if (!prompt) throw new AppError(404, "Prompt not found", "NOT_FOUND");

    const { expiresIn: rawExpiresIn } = request.body as { expiresIn?: string };
    const validatedExpiresIn = validateExpiresIn(rawExpiresIn);
    const expiresAt = parseExpiry(validatedExpiresIn);

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

    fastify.get("/prompt/:token", async (request, _reply) => {
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

  // GET /public/:token — unified public share endpoint (no auth required)
  // Resolves a shareToken across conversations, workflows, and prompts.
  fastify.get("/public/:token", async (request, reply) => {
    const { token } = request.params as { token: string };

    // Try conversations first
    const [sharedConvo] = await db
      .select()
      .from(sharedConversations)
      .where(eq(sharedConversations.shareToken, token))
      .limit(1);

    if (sharedConvo) {
      if (sharedConvo.expiresAt && sharedConvo.expiresAt < new Date()) {
        reply.code(410).send({ error: "Share link has expired", code: "SHARE_EXPIRED" });
        return;
      }

      const [conversation] = await db
        .select()
        .from(conversations)
        .where(eq(conversations.id, sharedConvo.conversationId))
        .limit(1);

      const chatList = await db
        .select()
        .from(chats)
        .where(eq(chats.conversationId, sharedConvo.conversationId))
        .orderBy(asc(chats.createdAt))
        .limit(100);

      // Increment viewCount if column exists
      try {
        const currentCount = ((sharedConvo as unknown as Record<string, unknown>).viewCount as number) ?? 0;
        await db
          .update(sharedConversations)
          .set({ viewCount: currentCount + 1 } as Record<string, unknown>)
          .where(eq(sharedConversations.shareToken, token));
      } catch {
        // viewCount column may not exist — ignore
      }

      return { type: "conversation", conversation, chats: chatList, access: sharedConvo.access };
    }

    // Try workflows
    const [sharedWf] = await db
      .select()
      .from(sharedWorkflows)
      .where(eq(sharedWorkflows.shareToken, token))
      .limit(1);

    if (sharedWf) {
      if (sharedWf.expiresAt && sharedWf.expiresAt < new Date()) {
        reply.code(410).send({ error: "Share link has expired", code: "SHARE_EXPIRED" });
        return;
      }

      const [workflow] = await db
        .select()
        .from(workflows)
        .where(eq(workflows.id, sharedWf.workflowId))
        .limit(1);

      // Increment viewCount if column exists
      try {
        const currentCount = ((sharedWf as unknown as Record<string, unknown>).viewCount as number) ?? 0;
        await db
          .update(sharedWorkflows)
          .set({ viewCount: currentCount + 1 } as Record<string, unknown>)
          .where(eq(sharedWorkflows.shareToken, token));
      } catch {
        // viewCount column may not exist — ignore
      }

      return { type: "workflow", workflow };
    }

    // Try prompts
    const [sharedPrompt] = await db
      .select()
      .from(sharedPrompts)
      .where(eq(sharedPrompts.shareToken, token))
      .limit(1);

    if (sharedPrompt) {
      if (sharedPrompt.expiresAt && sharedPrompt.expiresAt < new Date()) {
        reply.code(410).send({ error: "Share link has expired", code: "SHARE_EXPIRED" });
        return;
      }

      const [prompt] = await db
        .select()
        .from(prompts)
        .where(eq(prompts.id, sharedPrompt.promptId))
        .limit(1);

      const versions = await db
        .select()
        .from(promptVersions)
        .where(eq(promptVersions.promptId, sharedPrompt.promptId))
        .orderBy(desc(promptVersions.versionNum))
        .limit(1);

      // Increment viewCount if column exists
      try {
        const currentCount = ((sharedPrompt as unknown as Record<string, unknown>).viewCount as number) ?? 0;
        await db
          .update(sharedPrompts)
          .set({ viewCount: currentCount + 1 } as Record<string, unknown>)
          .where(eq(sharedPrompts.shareToken, token));
      } catch {
        // viewCount column may not exist — ignore
      }

      return { type: "prompt", prompt: prompt ? { ...prompt, versions } : null };
    }

    throw new AppError(404, "Share not found", "SHARE_NOT_FOUND");
  });
};

export default sharePlugin;
