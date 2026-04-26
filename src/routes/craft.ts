/**
 * Craft — Build Apps from Knowledge — Phase 4.9
 *
 * Onyx Craft-inspired: turn knowledge base content (docs, notes, files)
 * into deployable mini-apps (chatbots, dashboards, form handlers, search tools).
 *
 * Generates a self-contained app spec from KB + user requirements,
 * then produces the code scaffold (HTML/React/API) that can be deployed.
 *
 * Inspired by:
 * - Onyx Craft (danswer-ai/onyx) — build apps grounded in your knowledge base
 * - Langchain LangGraph Studio — app generation from agent graphs
 * - Flowise — low-code LLM app builder
 */

import type { FastifyInstance } from "fastify";
import { db } from "../lib/drizzle.js";
import { z } from "zod";
import { askProvider } from "../lib/providers.js";
import { env } from "../config/env.js";

// ─── App templates ────────────────────────────────────────────────────────────

const APP_TEMPLATES = {
  chatbot: {
    label: "Knowledge Chatbot",
    description: "An AI chatbot grounded in your KB that answers questions",
    outputType: "html",
  },
  search: {
    label: "Smart Search",
    description: "Semantic search UI over your knowledge base",
    outputType: "html",
  },
  dashboard: {
    label: "Data Dashboard",
    description: "Auto-generated dashboard from structured KB data",
    outputType: "html",
  },
  form: {
    label: "Smart Form",
    description: "AI-powered form that routes submissions based on content",
    outputType: "html",
  },
  api: {
    label: "REST API",
    description: "Auto-generated REST API with endpoints derived from your KB",
    outputType: "typescript",
  },
  summary: {
    label: "Knowledge Summary",
    description: "Periodic digest of your knowledge base changes",
    outputType: "markdown",
  },
} as const;

type AppTemplate = keyof typeof APP_TEMPLATES;

// ─── Schemas ─────────────────────────────────────────────────────────────────

const craftSchema = z.object({
  /** What the app should do */
  description: z.string().min(10).max(2000),
  /** Template to use */
  template: z.enum(["chatbot", "search", "dashboard", "form", "api", "summary"]),
  /** Knowledge context to inject (text dump of relevant KB content) */
  knowledgeContext: z.string().max(8000).optional(),
  /** App name */
  name: z.string().min(1).max(100),
  /** Custom instructions */
  instructions: z.string().max(1000).optional(),
});

const previewSchema = z.object({
  craftId: z.string().uuid(),
});

// ─── In-memory craft store (for draft/preview before export) ─────────────────
const craftStore = new Map<string, {
  userId: number;
  name: string;
  template: AppTemplate;
  description: string;
  generatedCode: string;
  outputType: string;
  createdAt: string;
}>();

// ─── Prompt builders ──────────────────────────────────────────────────────────

function buildCraftPrompt(
  template: AppTemplate,
  name: string,
  description: string,
  knowledgeContext: string,
  instructions: string,
  outputType: string,
): string {
  const templateDef = APP_TEMPLATES[template];

  if (outputType === "html") {
    return `You are an expert web app generator. Generate a complete, self-contained single-file HTML app.

App Type: ${templateDef.label}
App Name: ${name}
User Request: ${description}
${instructions ? `Special Instructions: ${instructions}` : ""}

Knowledge Base Context (use this to ground the app's content and behavior):
"""
${knowledgeContext || "(no knowledge context provided — generate a generic template)"}
"""

Requirements:
- Single HTML file with inline CSS (Tailwind via CDN) and inline JavaScript
- Modern, responsive, dark-mode-capable UI
- For chatbots: use fetch() to call /api/ask endpoint with the KB context injected
- For search: implement client-side search over the embedded knowledge data
- For dashboards: render data visualizations using Chart.js (CDN)
- For forms: include form validation and submission feedback
- Include realistic placeholder data based on the knowledge context
- Professional, polished design
- App title: "${name}"

Generate ONLY the complete HTML. No explanation, no markdown fences, just raw HTML starting with <!DOCTYPE html>.`;
  }

  if (outputType === "typescript") {
    return `You are an expert API generator. Generate a complete Fastify TypeScript route file.

App Type: ${templateDef.label}
App Name: ${name}
User Request: ${description}
${instructions ? `Special Instructions: ${instructions}` : ""}

Knowledge Base Context:
"""
${knowledgeContext || "(no knowledge context)"}
"""

Requirements:
- Fastify route plugin (export async function ${toCamelCase(name)}Plugin)
- RESTful endpoints derived from the knowledge context
- Zod validation on all inputs
- Include JSDoc comments explaining each endpoint
- Use in-memory data if no DB schema is obvious
- TypeScript, no 'any' types where avoidable

Generate ONLY the TypeScript code. No explanation.`;
  }

  // markdown summary
  return `Generate a comprehensive knowledge summary document.

Topic: ${name}
Description: ${description}

Knowledge Base Context:
"""
${knowledgeContext || "(no knowledge context)"}
"""

Format as clean Markdown with:
- Executive summary (3-5 sentences)
- Key facts and entities
- Important relationships
- Gaps and open questions
- Suggested next steps

Generate ONLY the Markdown content.`;
}

function toCamelCase(str: string): string {
  return str.replace(/[^a-zA-Z0-9]+(.)/g, (_, c) => c.toUpperCase()).replace(/^./, (c) => c.toLowerCase());
}

// ─── Routes ──────────────────────────────────────────────────────────────────

export async function craftPlugin(app: FastifyInstance) {
  const llmProvider = {
    name: "openai",
    type: "api" as const,
    apiKey: env.OPENAI_API_KEY ?? "",
    model: "gpt-4o",
    systemPrompt: "You are a precise code generation assistant. Generate complete, production-ready code.",
  };

  /**
   * GET /craft/templates
   * List available app templates.
   */
  app.get("/craft/templates", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    return {
      success: true,
      templates: Object.entries(APP_TEMPLATES).map(([id, t]) => ({ id, ...t })),
    };
  });

  /**
   * POST /craft/generate
   * Generate a mini-app from knowledge context.
   * Returns craftId + generated code.
   */
  app.post("/craft/generate", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const parsed = craftSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });

    const { description, template, knowledgeContext, name, instructions } = parsed.data;
    const outputType = APP_TEMPLATES[template].outputType;

    const prompt = buildCraftPrompt(
      template,
      name,
      description,
      knowledgeContext ?? "",
      instructions ?? "",
      outputType,
    );

    const response = await askProvider(llmProvider, [{ role: "user", content: prompt }]);
    let generatedCode = response.text.trim();

    // Strip markdown fences if LLM wrapped it anyway
    generatedCode = generatedCode
      .replace(/^```(?:html|typescript|ts|markdown|md)?\n?/i, "")
      .replace(/\n?```$/i, "")
      .trim();

    const { randomUUID } = await import("crypto");
    const craftId = randomUUID();
    craftStore.set(craftId, {
      userId,
      name,
      template,
      description,
      generatedCode,
      outputType,
      createdAt: new Date().toISOString(),
    });

    return reply.status(201).send({
      success: true,
      craftId,
      name,
      template,
      outputType,
      codeLength: generatedCode.length,
      preview: generatedCode.slice(0, 500),
    });
  });

  /**
   * GET /craft/:craftId
   * Retrieve a generated app by craftId.
   */
  app.get("/craft/:craftId", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const { craftId } = req.params as { craftId: string };
    const entry = craftStore.get(craftId);
    if (!entry || entry.userId !== userId) {
      return reply.status(404).send({ error: "Not found" });
    }

    return { success: true, craftId, ...entry };
  });

  /**
   * GET /craft/:craftId/download
   * Download the generated code as a file.
   */
  app.get("/craft/:craftId/download", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const { craftId } = req.params as { craftId: string };
    const entry = craftStore.get(craftId);
    if (!entry || entry.userId !== userId) {
      return reply.status(404).send({ error: "Not found" });
    }

    const ext = entry.outputType === "typescript" ? "ts"
      : entry.outputType === "markdown" ? "md"
      : "html";
    const filename = `${entry.name.replace(/[^a-z0-9-]/gi, "_")}.${ext}`;

    reply
      .header("Content-Disposition", `attachment; filename="${filename}"`)
      .header("Content-Type", "text/plain; charset=utf-8")
      .send(entry.generatedCode);
  });

  /**
   * GET /craft
   * List all crafted apps for the user.
   */
  app.get("/craft", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const apps = [...craftStore.entries()]
      .filter(([, v]) => v.userId === userId)
      .map(([id, v]) => ({
        craftId: id,
        name: v.name,
        template: v.template,
        outputType: v.outputType,
        description: v.description,
        createdAt: v.createdAt,
      }));

    return { success: true, apps, count: apps.length };
  });

  /**
   * DELETE /craft/:craftId
   * Remove a crafted app from the store.
   */
  app.delete("/craft/:craftId", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const { craftId } = req.params as { craftId: string };
    const entry = craftStore.get(craftId);
    if (!entry || entry.userId !== userId) {
      return reply.status(404).send({ error: "Not found" });
    }
    craftStore.delete(craftId);
    return { success: true };
  });
}
