import { Router, Request, Response } from "express";
import prisma from "../lib/db.js";
import logger from "../lib/logger.js";
import { requireAuth } from "../middleware/auth.js";
import { AuthRequest } from "../types/index.js";
import { AppError } from "../middleware/errorHandler.js";

const router = Router();

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
router.get("/conversation/:id", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const { id } = req.params;

    const conversation = await prisma.conversation.findFirst({
      where: {
        id: String(id),
        userId,
      },
      include: {
        chats: {
          orderBy: { createdAt: "asc" },
        },
      },
    }) as { id: string; title: string; createdAt: Date; updatedAt: Date; chats: { id: number; question: string; verdict: string | null; opinions: unknown; durationMs: number | null; tokensUsed: number | null; createdAt: Date }[] } | null;

    if (!conversation) {
      return res.status(404).json({ error: "Conversation not found" });
    }

    const exportData = {
      exportedAt: new Date().toISOString(),
      conversation: {
        id: conversation.id,
        title: conversation.title,
        createdAt: conversation.createdAt,
        updatedAt: conversation.updatedAt,
        chats: conversation.chats.map((chat: { id: number; question: string; verdict: string | null; opinions: unknown; durationMs: number | null; tokensUsed: number | null; createdAt: Date }) => ({
          id: chat.id,
          question: chat.question,
          verdict: chat.verdict,
          opinions: chat.opinions,
          durationMs: chat.durationMs,
          tokensUsed: chat.tokensUsed,
          createdAt: chat.createdAt,
        })),
      },
    };

    res.setHeader("Content-Type", "application/json");
    res.setHeader("Content-Disposition", `attachment; filename="conversation-${id}.json"`);
    res.json(exportData);
  } catch (err) {
    logger.error({ err: (err as Error).message }, "Failed to export conversation");
    throw new AppError(500, "Failed to export conversation", "EXPORT_FAILED");
  }
});

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
router.get("/all", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId!;

    const conversations = await prisma.conversation.findMany({
      where: { userId },
      include: {
        chats: {
          orderBy: { createdAt: "asc" },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    const exportData = {
      exportedAt: new Date().toISOString(),
      totalConversations: conversations.length,
      totalChats: conversations.reduce((sum: number, c: { chats: { length: number } }) => sum + c.chats.length, 0),
      conversations: conversations.map((conv: { id: string; title: string; createdAt: Date; updatedAt: Date; chats: { id: number; question: string; verdict: string | null; opinions: unknown; durationMs: number | null; tokensUsed: number | null; createdAt: Date }[] }) => ({
        id: conv.id,
        title: conv.title,
        createdAt: conv.createdAt,
        updatedAt: conv.updatedAt,
        chats: conv.chats.map((chat: { id: number; question: string; verdict: string | null; opinions: unknown; durationMs: number | null; tokensUsed: number | null; createdAt: Date }) => ({
          id: chat.id,
          question: chat.question,
          verdict: chat.verdict,
          opinions: chat.opinions,
          durationMs: chat.durationMs,
          tokensUsed: chat.tokensUsed,
          createdAt: chat.createdAt,
        })),
      })),
    };

    res.setHeader("Content-Type", "application/json");
    res.setHeader("Content-Disposition", 'attachment; filename="all-conversations.json"');
    res.json(exportData);
  } catch (err) {
    logger.error({ err: (err as Error).message }, "Failed to export all conversations");
    throw new AppError(500, "Failed to export conversations", "EXPORT_FAILED");
  }
});

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
router.get("/conversation/:id/markdown", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const { id } = req.params;

    const conversation = await prisma.conversation.findFirst({
      where: {
        id: String(id),
        userId,
      },
      include: {
        chats: {
          orderBy: { createdAt: "asc" },
        },
      },
    }) as { id: string; title: string; createdAt: Date; updatedAt: Date; chats: { id: number; question: string; verdict: string | null; opinions: unknown; durationMs: number | null; tokensUsed: number | null; createdAt: Date }[] } | null;

    if (!conversation) {
      return res.status(404).json({ error: "Conversation not found" });
    }

    let markdown = `# ${conversation.title}\n\n`;
    markdown += `**Exported:** ${new Date().toISOString()}\n\n`;
    markdown += `---\n\n`;

    for (const chat of conversation.chats) {
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

    res.setHeader("Content-Type", "text/markdown");
    res.setHeader("Content-Disposition", `attachment; filename="conversation-${id}.md"`);
    res.send(markdown);
  } catch (err) {
    logger.error({ err: (err as Error).message }, "Failed to export conversation as markdown");
    throw new AppError(500, "Failed to export conversation", "EXPORT_FAILED");
  }
});

export default router;
