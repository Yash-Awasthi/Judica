import { FastifyPluginAsync } from "fastify";
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

/**
 * @openapi
 * /api/artifacts:
 *   get:
 *     tags:
 *       - Sandbox
 *     summary: List user artifacts
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: conversation_id
 *         schema:
 *           type: string
 *         description: Filter by conversation ID
 *       - in: query
 *         name: type
 *         schema:
 *           type: string
 *         description: Filter by artifact type
 *     responses:
 *       200:
 *         description: List of artifacts
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 artifacts:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id:
 *                         type: string
 *                       name:
 *                         type: string
 *                       type:
 *                         type: string
 *                       language:
 *                         type: string
 *                         nullable: true
 *                       conversationId:
 *                         type: string
 *                       createdAt:
 *                         type: string
 *                         format: date-time
 *                       updatedAt:
 *                         type: string
 *                         format: date-time
 *       401:
 *         description: Unauthorized
 */
const artifactsPlugin: FastifyPluginAsync = async (fastify) => {
  // GET /api/artifacts — list user's artifacts
  fastify.get("/", { preHandler: fastifyRequireAuth }, async (request, reply) => {
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

  /**
   * @openapi
   * /api/artifacts/{id}:
   *   get:
   *     tags:
   *       - Sandbox
   *     summary: Get an artifact by ID
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *         description: Artifact ID
   *     responses:
   *       200:
   *         description: Artifact details
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *       401:
   *         description: Unauthorized
   *       404:
   *         description: Artifact not found
   */
  // GET /api/artifacts/:id — get artifact
  fastify.get("/:id", { preHandler: fastifyRequireAuth }, async (request, reply) => {
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

  /**
   * @openapi
   * /api/artifacts/{id}:
   *   put:
   *     tags:
   *       - Sandbox
   *     summary: Update an artifact
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *         description: Artifact ID
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               name:
   *                 type: string
   *               content:
   *                 type: string
   *     responses:
   *       200:
   *         description: Updated artifact
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *       401:
   *         description: Unauthorized
   *       404:
   *         description: Artifact not found
   */
  // PUT /api/artifacts/:id — update artifact
  fastify.put("/:id", { preHandler: fastifyRequireAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as { name?: string; content?: string };

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

  /**
   * @openapi
   * /api/artifacts/{id}:
   *   delete:
   *     tags:
   *       - Sandbox
   *     summary: Delete an artifact
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *         description: Artifact ID
   *     responses:
   *       200:
   *         description: Artifact deleted
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 success:
   *                   type: boolean
   *       401:
   *         description: Unauthorized
   *       404:
   *         description: Artifact not found
   */
  // DELETE /api/artifacts/:id — delete
  fastify.delete("/:id", { preHandler: fastifyRequireAuth }, async (request, reply) => {
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

  /**
   * @openapi
   * /api/artifacts/{id}/download:
   *   get:
   *     tags:
   *       - Sandbox
   *     summary: Download an artifact as a file
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *         description: Artifact ID
   *     responses:
   *       200:
   *         description: File download
   *         content:
   *           text/plain:
   *             schema:
   *               type: string
   *               format: binary
   *       401:
   *         description: Unauthorized
   *       404:
   *         description: Artifact not found
   */
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
