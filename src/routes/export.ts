import { FastifyPluginAsync } from "fastify";
import { db } from "../lib/drizzle.js";
import { conversations, chats } from "../db/schema/conversations.js";
import { eq, and, desc, asc } from "drizzle-orm";
import logger from "../lib/logger.js";
import { AppError } from "../middleware/errorHandler.js";
import { fastifyRequireAuth } from "../middleware/fastifyAuth.js";

// ─── Helper to map chat rows to export shape ────────────────────────────────

function mapChat(chat: {
  id: number;
  question: string;
  verdict: string;
  opinions: unknown;
  durationMs: number | null;
  tokensUsed: number | null;
  createdAt: Date;
}) {
  return {
    id: chat.id,
    question: chat.question,
    verdict: chat.verdict,
    opinions: chat.opinions,
    durationMs: chat.durationMs,
    tokensUsed: chat.tokensUsed,
    createdAt: chat.createdAt,
  };
}

// ─── Plugin ─────────────────────────────────────────────────────────────────

const exportPlugin: FastifyPluginAsync = async (fastify) => {
  /**
   * @openapi
   * /api/export/conversation/{id}:
   *   get:
   *     tags:
   *       - Export
   *     summary: Export a conversation as JSON
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *         description: Conversation ID
   *     responses:
   *       200:
   *         description: Conversation JSON file download
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 exportedAt:
   *                   type: string
   *                   format: date-time
   *                 conversation:
   *                   type: object
   *       401:
   *         description: Unauthorized
   *       404:
   *         description: Conversation not found
   *       500:
   *         description: Export failed
   */
  fastify.get<{ Params: { id: string } }>(
    "/conversation/:id",
    { preHandler: fastifyRequireAuth },
    async (request, reply) => {
      try {
        const userId = request.userId!;
        const { id } = request.params;

        const [conversation] = await db
          .select()
          .from(conversations)
          .where(
            and(
              eq(conversations.id, String(id)),
              eq(conversations.userId, userId),
            ),
          )
          .limit(1);

        if (!conversation) {
          reply.code(404).send({ error: "Conversation not found" });
          return;
        }

        const chatRows = await db
          .select()
          .from(chats)
          .where(eq(chats.conversationId, String(id)))
          .orderBy(asc(chats.createdAt));

        const exportData = {
          exportedAt: new Date().toISOString(),
          conversation: {
            id: conversation.id,
            title: conversation.title,
            createdAt: conversation.createdAt,
            updatedAt: conversation.updatedAt,
            chats: chatRows.map(mapChat),
          },
        };

        reply.header(
          "Content-Disposition",
          `attachment; filename="conversation-${id}.json"`,
        );
        reply.type("application/json");
        return exportData;
      } catch (err) {
        logger.error(
          { err: (err as Error).message },
          "Failed to export conversation",
        );
        throw new AppError(500, "Failed to export conversation", "EXPORT_FAILED");
      }
    },
  );

  /**
   * @openapi
   * /api/export/all:
   *   get:
   *     tags:
   *       - Export
   *     summary: Export all conversations as JSON
   *     security:
   *       - bearerAuth: []
   *     responses:
   *       200:
   *         description: All conversations JSON file download
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 exportedAt:
   *                   type: string
   *                   format: date-time
   *                 totalConversations:
   *                   type: integer
   *                 totalChats:
   *                   type: integer
   *                 conversations:
   *                   type: array
   *                   items:
   *                     type: object
   *       401:
   *         description: Unauthorized
   *       500:
   *         description: Export failed
   */
  fastify.get(
    "/all",
    { preHandler: fastifyRequireAuth },
    async (request, reply) => {
      try {
        const userId = request.userId!;

        const convRows = await db
          .select()
          .from(conversations)
          .where(eq(conversations.userId, userId))
          .orderBy(desc(conversations.createdAt));

        // Fetch chats for every conversation in one query, then group
        const convIds = convRows.map((c) => c.id);
        let allChats: (typeof chats.$inferSelect)[] = [];
        if (convIds.length > 0) {
          const { inArray } = await import("drizzle-orm");
          allChats = await db
            .select()
            .from(chats)
            .where(inArray(chats.conversationId, convIds))
            .orderBy(asc(chats.createdAt));
        }

        const chatsByConv = new Map<string, (typeof chats.$inferSelect)[]>();
        for (const chat of allChats) {
          const cid = chat.conversationId!;
          if (!chatsByConv.has(cid)) chatsByConv.set(cid, []);
          chatsByConv.get(cid)!.push(chat);
        }

        const mapped = convRows.map((conv) => {
          const convChats = chatsByConv.get(conv.id) || [];
          return {
            id: conv.id,
            title: conv.title,
            createdAt: conv.createdAt,
            updatedAt: conv.updatedAt,
            chats: convChats.map(mapChat),
          };
        });

        const exportData = {
          exportedAt: new Date().toISOString(),
          totalConversations: mapped.length,
          totalChats: mapped.reduce((sum, c) => sum + c.chats.length, 0),
          conversations: mapped,
        };

        reply.header(
          "Content-Disposition",
          'attachment; filename="all-conversations.json"',
        );
        reply.type("application/json");
        return exportData;
      } catch (err) {
        logger.error(
          { err: (err as Error).message },
          "Failed to export all conversations",
        );
        throw new AppError(
          500,
          "Failed to export conversations",
          "EXPORT_FAILED",
        );
      }
    },
  );

  /**
   * @openapi
   * /api/export/conversation/{id}/markdown:
   *   get:
   *     tags:
   *       - Export
   *     summary: Export a conversation as Markdown
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *         description: Conversation ID
   *     responses:
   *       200:
   *         description: Markdown file download
   *         content:
   *           text/markdown:
   *             schema:
   *               type: string
   *       401:
   *         description: Unauthorized
   *       404:
   *         description: Conversation not found
   *       500:
   *         description: Export failed
   */
  fastify.get<{ Params: { id: string } }>(
    "/conversation/:id/markdown",
    { preHandler: fastifyRequireAuth },
    async (request, reply) => {
      try {
        const userId = request.userId!;
        const { id } = request.params;

        const [conversation] = await db
          .select()
          .from(conversations)
          .where(
            and(
              eq(conversations.id, String(id)),
              eq(conversations.userId, userId),
            ),
          )
          .limit(1);

        if (!conversation) {
          reply.code(404).send({ error: "Conversation not found" });
          return;
        }

        const chatRows = await db
          .select()
          .from(chats)
          .where(eq(chats.conversationId, String(id)))
          .orderBy(asc(chats.createdAt));

        let markdown = `# ${conversation.title}\n\n`;
        markdown += `**Exported:** ${new Date().toISOString()}\n\n`;
        markdown += `---\n\n`;

        for (const chat of chatRows) {
          markdown += `## Question\n\n${chat.question}\n\n`;
          markdown += `## Verdict\n\n${chat.verdict}\n\n`;

          if (chat.opinions && typeof chat.opinions === "object") {
            const opinions = chat.opinions as Record<string, string>;
            markdown += `## Council Opinions\n\n`;
            for (const [name, opinion] of Object.entries(opinions)) {
              markdown += `### ${name}\n\n${opinion}\n\n`;
            }
          }

          markdown += `---\n\n`;
        }

        reply.type("text/markdown");
        reply.header(
          "Content-Disposition",
          `attachment; filename="conversation-${id}.md"`,
        );
        return markdown;
      } catch (err) {
        logger.error(
          { err: (err as Error).message },
          "Failed to export conversation as markdown",
        );
        throw new AppError(
          500,
          "Failed to export conversation",
          "EXPORT_FAILED",
        );
      }
    },
  );
};

export default exportPlugin;
