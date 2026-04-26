import type { FastifyPluginAsync } from "fastify";
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

        // Sanitize id in Content-Disposition to prevent header injection
        const safeId = String(id).replace(/[^a-zA-Z0-9_-]/g, "_");
        reply.header(
          "Content-Disposition",
          `attachment; filename="conversation-${safeId}.json"`,
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

    fastify.get(
    "/all",
    { preHandler: fastifyRequireAuth },
    async (request, reply) => {
      try {
        const userId = request.userId!;

        // Limit export to most recent 200 conversations to prevent OOM on large accounts
        const MAX_EXPORT_CONVERSATIONS = 200;
        const convRows = await db
          .select()
          .from(conversations)
          .where(eq(conversations.userId, userId))
          .orderBy(desc(conversations.createdAt))
          .limit(MAX_EXPORT_CONVERSATIONS);

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

  // Phase 1.23 — Structured Deliberation Report (Pandoc/docx pattern)
  // Produces a rich markdown report with per-member sections and metadata
  fastify.get<{ Params: { id: string }; Querystring: { format?: string } }>(
    "/conversation/:id/report",
    { preHandler: fastifyRequireAuth },
    async (request, reply) => {
      const userId = request.userId!;
      const { id } = request.params;
      const format = (request.query as any).format ?? "markdown";

      const [conversation] = await db
        .select()
        .from(conversations)
        .where(and(eq(conversations.id, String(id)), eq(conversations.userId, userId)))
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

      const exportedAt = new Date().toISOString();

      // Build structured report
      let report = `# Deliberation Report: ${conversation.title}\n\n`;
      report += `> **Exported:** ${exportedAt}  \n`;
      report += `> **Conversation ID:** ${conversation.id}  \n`;
      report += `> **Turns:** ${chatRows.length}  \n\n`;
      report += `---\n\n`;

      chatRows.forEach((chat, idx) => {
        report += `## Turn ${idx + 1}\n\n`;
        report += `### Question\n\n${chat.question}\n\n`;

        // Council opinions section
        const opinions = Array.isArray(chat.opinions)
          ? chat.opinions as Array<{ name: string; opinion: string }>
          : [];

        if (opinions.length > 0) {
          report += `### Council Deliberation\n\n`;
          for (const op of opinions) {
            report += `#### ${op.name || "Agent"}\n\n${op.opinion || ""}\n\n`;
          }
        }

        report += `### Verdict\n\n${chat.verdict}\n\n`;

        if (chat.durationMs) {
          report += `*Response time: ${(chat.durationMs / 1000).toFixed(1)}s*\n\n`;
        }
        if (chat.tokensUsed) {
          report += `*Tokens used: ${chat.tokensUsed}*\n\n`;
        }
        report += `---\n\n`;
      });

      const safeId = String(id).replace(/[^a-zA-Z0-9_-]/g, "_");

      if (format === "html") {
        // Simple markdown-to-HTML conversion (no external dep)
        const html = markdownToSimpleHtml(report, conversation.title);
        reply.type("text/html");
        reply.header("Content-Disposition", `attachment; filename="report-${safeId}.html"`);
        return html;
      }

      reply.type("text/markdown");
      reply.header("Content-Disposition", `attachment; filename="report-${safeId}.md"`);
      return report;
    },
  );
};

export default exportPlugin;

/** Minimal markdown→HTML converter for report export (no external deps) */
function markdownToSimpleHtml(markdown: string, title: string): string {
  const body = markdown
    .replace(/^#### (.+)$/gm, "<h4>$1</h4>")
    .replace(/^### (.+)$/gm, "<h3>$1</h3>")
    .replace(/^## (.+)$/gm, "<h2>$1</h2>")
    .replace(/^# (.+)$/gm, "<h1>$1</h1>")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(/^> (.+)$/gm, "<blockquote>$1</blockquote>")
    .replace(/^---$/gm, "<hr>")
    .replace(/\n\n/g, "</p><p>")
    .replace(/\n/g, "<br>");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 900px; margin: 2rem auto; padding: 0 1rem; line-height: 1.6; color: #1a1a1a; }
    h1 { border-bottom: 2px solid #e5e7eb; padding-bottom: 0.5rem; }
    h2 { margin-top: 2rem; color: #374151; }
    h3 { color: #4b5563; }
    h4 { color: #6b7280; font-style: italic; }
    blockquote { border-left: 4px solid #e5e7eb; margin: 0; padding: 0.5rem 1rem; color: #6b7280; }
    hr { border: none; border-top: 1px solid #e5e7eb; margin: 2rem 0; }
    em { color: #6b7280; font-size: 0.9rem; }
  </style>
</head>
<body>
<p>${body}</p>
</body>
</html>`;
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] ?? c));
}
