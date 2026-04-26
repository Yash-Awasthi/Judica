/**
 * File Generator routes — Phase 3.7
 *
 * Explicit file generation endpoint: council outputs a file in the requested format.
 * File is stored as an artifact in the Artifacts tab.
 *
 * Inspired by jsPDF, ExcelJS, Archiver.
 */

import { FastifyInstance } from "fastify";
import { generateFile, detectFileGenerationIntent, type GeneratableFormat } from "../lib/fileGenerator.js";
import { db } from "../lib/drizzle.js";
import { artifacts } from "../db/schema/research.js";
import { askProvider } from "../lib/providers.js";
import { z } from "zod";

const generateSchema = z.object({
  format:         z.enum(["csv","json","markdown","html","svg","tsv","txt","pdf","xlsx","zip"]),
  prompt:         z.string().min(1),
  filename:       z.string().optional(),
  conversationId: z.string().optional(),
});

const MIME_EXT: Record<string, string> = {
  csv: "csv", json: "json", markdown: "md", html: "html",
  svg: "svg", tsv: "tsv", txt: "txt", pdf: "pdf", xlsx: "xlsx", zip: "zip",
};

export async function fileGeneratorPlugin(app: FastifyInstance) {
  // POST /files/generate — generate a file from a prompt
  app.post("/files/generate", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const parsed = generateSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });

    const { format, prompt, filename: rawFilename, conversationId } = parsed.data;

    // 1. Use LLM to generate the raw content
    const systemPrompt = `You are a file content generator. Generate ${format.toUpperCase()} content based on the user's request. Output ONLY the file content — no explanation, no preamble, just the raw ${format} content that will be saved directly to a file.`;

    const contentRes = await askProvider(
      { id: "openai", model: "gpt-4o-mini", systemPrompt },
      [{ role: "user", content: prompt }],
      4000,
    );

    // 2. Format the content appropriately
    const ext = MIME_EXT[format] ?? format;
    const baseFilename = rawFilename ?? `generated-${Date.now()}.${ext}`;
    const file = await generateFile(format as GeneratableFormat, contentRes.text, baseFilename);

    // 3. Store as artifact
    const [artifact] = await db
      .insert(artifacts)
      .values({
        userId,
        name:           file.filename,
        type:           format === "markdown" ? "markdown" : format === "html" ? "html" : "code",
        language:       format,
        content:        file.content,
        conversationId: conversationId ?? null,
      })
      .returning();

    return reply.status(201).send({
      success:  true,
      artifact,
      file: {
        filename:    file.filename,
        mimeType:    file.mimeType,
        format:      file.format,
        description: file.description,
        contentLength: file.content.length,
      },
    });
  });

  // POST /files/detect-intent — check if a question is requesting file generation
  app.post("/files/detect-intent", async (req, reply) => {
    const { question } = req.body as { question?: string };
    if (!question) return reply.status(400).send({ error: "question required" });

    const format = detectFileGenerationIntent(question);
    return { success: true, isFileGeneration: !!format, format: format ?? null };
  });

  // GET /files/supported — list supported formats
  app.get("/files/supported", async (_req, reply) => {
    return {
      success: true,
      formats: [
        { format: "csv",      mime: "text/csv",            native: true,  description: "Comma-separated values" },
        { format: "tsv",      mime: "text/tab-separated-values", native: true, description: "Tab-separated values" },
        { format: "json",     mime: "application/json",    native: true,  description: "JSON data" },
        { format: "markdown", mime: "text/markdown",        native: true,  description: "Markdown document" },
        { format: "html",     mime: "text/html",            native: true,  description: "HTML document" },
        { format: "svg",      mime: "image/svg+xml",        native: true,  description: "SVG image" },
        { format: "txt",      mime: "text/plain",           native: true,  description: "Plain text" },
        { format: "pdf",      mime: "application/pdf",      native: false, description: "PDF (requires jsPDF)" },
        { format: "xlsx",     mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", native: false, description: "Excel (requires ExcelJS)" },
        { format: "zip",      mime: "application/zip",      native: false, description: "ZIP archive (requires archiver)" },
      ],
    };
  });
}
