import type { FastifyPluginAsync } from "fastify";
import { db } from "../lib/drizzle.js";
import { artifacts } from "../db/schema/research.js";
import { eq, and, desc } from "drizzle-orm";
import { fastifyRequireAuth } from "../middleware/fastifyAuth.js";
import { AppError } from "../middleware/errorHandler.js";

const MIME_TYPES: Record<string, string> = {
  code: "text/plain",
  markdown: "text/markdown",
  html: "text/html",
  json: "application/json",
  csv: "text/csv",
};

const EXTENSIONS: Record<string, string> = {
  code: "txt",
  markdown: "md",
  html: "html",
  json: "json",
  csv: "csv",
};

const LANG_EXTENSIONS: Record<string, string> = {
  javascript: "js",
  typescript: "ts",
  python: "py",
  ruby: "rb",
  go: "go",
  rust: "rs",
  java: "java",
  "c++": "cpp",
  c: "c",
  bash: "sh",
  sql: "sql",
  html: "html",
  css: "css",
};

const artifactsPlugin: FastifyPluginAsync = async (fastify) => {
  // GET /api/artifacts — list user's artifacts
  fastify.get("/", { preHandler: fastifyRequireAuth }, async (request, _reply) => {
    const { conversation_id, type } = request.query as {
      conversation_id?: string;
      type?: string;
    };

    const conditions = [eq(artifacts.userId, request.userId!)];
    if (conversation_id) conditions.push(eq(artifacts.conversationId, conversation_id));
    if (type) conditions.push(eq(artifacts.type, type));

    const rows = await db
      .select({
        id: artifacts.id,
        name: artifacts.name,
        type: artifacts.type,
        language: artifacts.language,
        conversationId: artifacts.conversationId,
        createdAt: artifacts.createdAt,
        updatedAt: artifacts.updatedAt,
      })
      .from(artifacts)
      .where(and(...conditions))
      .orderBy(desc(artifacts.createdAt))
      .limit(50);

    return { artifacts: rows };
  });

    // GET /api/artifacts/:id — get artifact
  fastify.get("/:id", { preHandler: fastifyRequireAuth }, async (request, _reply) => {
    const { id } = request.params as { id: string };

    const artifact = await db
      .select()
      .from(artifacts)
      .where(and(eq(artifacts.id, id), eq(artifacts.userId, request.userId!)))
      .limit(1)
      .then((rows) => rows[0]);

    if (!artifact) throw new AppError(404, "Artifact not found", "ARTIFACT_NOT_FOUND");

    return artifact;
  });

    // PUT /api/artifacts/:id — update artifact
  fastify.put("/:id", { preHandler: fastifyRequireAuth }, async (request, _reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as { name?: string; content?: string };

    if (body.name !== undefined) {
      if (typeof body.name !== "string" || body.name.length > 500) {
        throw new AppError(400, "name must be a string of at most 500 characters", "INVALID_NAME");
      }
    }
    if (body.content !== undefined) {
      if (typeof body.content !== "string" || body.content.length > 500_000) {
        throw new AppError(400, "content must be a string of at most 500000 characters", "INVALID_CONTENT");
      }
    }

    const existing = await db
      .select()
      .from(artifacts)
      .where(and(eq(artifacts.id, id), eq(artifacts.userId, request.userId!)))
      .limit(1)
      .then((rows) => rows[0]);

    if (!existing) throw new AppError(404, "Artifact not found", "ARTIFACT_NOT_FOUND");

    const updates: Record<string, unknown> = {};
    if (body.name !== undefined) updates.name = body.name;
    if (body.content !== undefined) updates.content = body.content;

    const [updated] = await db
      .update(artifacts)
      .set(updates)
      .where(eq(artifacts.id, existing.id))
      .returning();

    return updated;
  });

    // DELETE /api/artifacts/:id — delete
  fastify.delete("/:id", { preHandler: fastifyRequireAuth }, async (request, _reply) => {
    const { id } = request.params as { id: string };

    const existing = await db
      .select()
      .from(artifacts)
      .where(and(eq(artifacts.id, id), eq(artifacts.userId, request.userId!)))
      .limit(1)
      .then((rows) => rows[0]);

    if (!existing) throw new AppError(404, "Artifact not found", "ARTIFACT_NOT_FOUND");

    await db.delete(artifacts).where(eq(artifacts.id, existing.id));

    return { success: true };
  });

    // GET /api/artifacts/:id/download — download as file
  fastify.get("/:id/download", { preHandler: fastifyRequireAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };

    const artifact = await db
      .select()
      .from(artifacts)
      .where(and(eq(artifacts.id, id), eq(artifacts.userId, request.userId!)))
      .limit(1)
      .then((rows) => rows[0]);

    if (!artifact) throw new AppError(404, "Artifact not found", "ARTIFACT_NOT_FOUND");

    const mimeType = MIME_TYPES[artifact.type] || "text/plain";
    const ext = artifact.type === "code" && artifact.language
      ? (LANG_EXTENSIONS[artifact.language] || "txt")
      : (EXTENSIONS[artifact.type] || "txt");

    const safeName = artifact.name.replace(/[^a-zA-Z0-9_.-]/g, "_");
    const filename = `${safeName}.${ext}`;

    reply.header("Content-Type", mimeType);
    reply.header("Content-Disposition", `attachment; filename="${filename}"`);
    return reply.send(artifact.content);
  });
};

export default artifactsPlugin;
