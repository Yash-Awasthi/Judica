import { Router, Response } from "express";
import prisma from "../lib/db.js";
import { requireAuth } from "../middleware/auth.js";
import { AuthRequest } from "../types/index.js";
import { AppError } from "../middleware/errorHandler.js";

const router = Router();

router.get("/markdown/:conversationId", requireAuth, async (req: AuthRequest, res: Response, next) => {
  try {
    const conversationId: string = req.params.conversationId as string;
    if (!conversationId) throw new AppError(400, "Missing conversation ID");

    const conversation = await prisma.conversation.findFirst({
      where: {
        id: conversationId,
        userId: req.userId,
      },
      include: {
        chats: {
          orderBy: { createdAt: "asc" }
        }
      }
    });

    if (!conversation) {
      throw new AppError(404, "Conversation not found");
    }

    let markdown = `# ${conversation.title}\n\n`;
    markdown += `*Exported on ${new Date().toLocaleString()}*\n\n---\n\n`;

    const chats = (conversation as any).chats || [];
    for (const chat of chats) {
      markdown += `## Question\n${chat.question.replace(/^#/gm, '\\#')}\n\n`;
      
      let opinions = [];
      if (typeof chat.opinions === 'string') {
        try { opinions = JSON.parse(chat.opinions); } catch(_e) { /* opinions is not JSON string, skip */ }
      } else if (Array.isArray(chat.opinions)) {
        opinions = chat.opinions;
      }

      if (opinions.length > 0) {
        markdown += `### Council Opinions\n\n`;
        for (const op of opinions) {
          const opinionText = op.opinion || op.text || op.answer || "";
          markdown += `**${op.name}**:\n${opinionText.replace(/^#/gm, '\\#')}\n\n`;
        }
      }

      markdown += `### Final Verdict\n${chat.verdict.replace(/^#/gm, '\\#')}\n\n---\n\n`;
    }

    res.setHeader('Content-Type', 'text/markdown');
    res.setHeader('Content-Disposition', `attachment; filename="council-export-${conversation.id}.md"`);
    res.send(markdown);
  } catch (e) {
    next(e);
  }
});

// ── GET /api/export/json/:conversationId ────────────────────────────────────
router.get("/json/:conversationId", requireAuth, async (req: AuthRequest, res: Response, next) => {
  try {
    const conversationId: string = req.params.conversationId as string;
    if (!conversationId) throw new AppError(400, "Missing conversation ID");

    const conversation = await prisma.conversation.findFirst({
      where: {
        id: conversationId,
        userId: req.userId,
      },
      include: {
        chats: {
          orderBy: { createdAt: "asc" },
          select: {
            id: true,
            createdAt: true,
            question: true,
            verdict: true,
            opinions: true,
            tokensUsed: true,
            durationMs: true
          }
        }
      }
    });

    if (!conversation) {
      throw new AppError(404, "Conversation not found");
    }

    // Parse opinions if they are strings
    if (conversation.chats) {
      for (const chat of conversation.chats) {
        if (typeof chat.opinions === 'string') {
          try { chat.opinions = JSON.parse(chat.opinions); } catch(_e) { /* ignore */ }
        }
      }
    }

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="council-export-${conversation.id}.json"`);
    res.json(conversation);
  } catch (e) {
    next(e);
  }
});

export default router;
