import { FastifyPluginAsync } from "fastify";
import { randomUUID } from "crypto";
import { db } from "../lib/drizzle.js";
import { prompts, promptVersions } from "../db/schema/prompts.js";
import { eq, and, desc, max } from "drizzle-orm";
import { fastifyRequireAuth } from "../middleware/fastifyAuth.js";
import { AppError } from "../middleware/errorHandler.js";
import { routeAndCollect } from "../router/index.js";
import logger from "../lib/logger.js";

const promptsPlugin: FastifyPluginAsync = async (fastify) => {
  /**
   * @openapi
   * /prompts:
   *   get:
   *     summary: List user's prompts
   *     description: Returns all prompts belonging to the authenticated user, ordered by creation date descending. Each prompt includes its latest version summary.
   *     tags:
   *       - Prompts
   *     security:
   *       - bearerAuth: []
   *     responses:
   *       200:
   *         description: A list of prompts
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 prompts:
   *                   type: array
   *                   items:
   *                     type: object
   *                     properties:
   *                       id:
   *                         type: string
   *                       name:
   *                         type: string
   *                       description:
   *                         type: string
   *                         nullable: true
   *                       createdAt:
   *                         type: string
   *                         format: date-time
   *                       versions:
   *                         type: array
   *                         items:
   *                           type: object
   *                           properties:
   *                             id:
   *                               type: string
   *                             versionNum:
   *                               type: integer
   *                             createdAt:
   *                               type: string
   *                               format: date-time
   *       401:
   *         description: Unauthorized
   */
  // GET / — list user's prompts
  fastify.get("/", { preHandler: fastifyRequireAuth }, async (request, reply) => {
    const userPrompts = await db
      .select()
      .from(prompts)
      .where(eq(prompts.userId, request.userId!))
      .orderBy(desc(prompts.createdAt));

    // For each prompt, fetch the latest version summary
    const result = await Promise.all(
      userPrompts.map(async (p) => {
        const versions = await db
          .select({
            id: promptVersions.id,
            versionNum: promptVersions.versionNum,
            createdAt: promptVersions.createdAt,
          })
          .from(promptVersions)
          .where(eq(promptVersions.promptId, p.id))
          .orderBy(desc(promptVersions.versionNum))
          .limit(1);

        return { ...p, versions };
      }),
    );

    return { prompts: result };
  });

  /**
   * @openapi
   * /prompts:
   *   post:
   *     summary: Create a prompt with its first version
   *     description: Creates a new prompt and its initial version (version 1) for the authenticated user.
   *     tags:
   *       - Prompts
   *     security:
   *       - bearerAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required:
   *               - name
   *               - content
   *             properties:
   *               name:
   *                 type: string
   *                 description: Name of the prompt
   *               description:
   *                 type: string
   *                 description: Optional description
   *               content:
   *                 type: string
   *                 description: Prompt content text
   *               model:
   *                 type: string
   *                 description: Optional model identifier
   *               temperature:
   *                 type: number
   *                 description: Optional temperature setting
   *     responses:
   *       201:
   *         description: Prompt created successfully
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 id:
   *                   type: string
   *                 name:
   *                   type: string
   *                 description:
   *                   type: string
   *                   nullable: true
   *                 createdAt:
   *                   type: string
   *                   format: date-time
   *                 versions:
   *                   type: array
   *                   items:
   *                     $ref: '#/components/schemas/PromptVersion'
   *       400:
   *         description: Validation error — name or content missing
   *       401:
   *         description: Unauthorized
   */
  // POST / — create prompt + first version
  fastify.post("/", { preHandler: fastifyRequireAuth }, async (request, reply) => {
    const { name, description, content, model, temperature } = request.body as any;

    if (!name || typeof name !== "string" || name.trim().length === 0) {
      throw new AppError(400, "Name is required", "PROMPT_NAME_REQUIRED");
    }
    if (!content || typeof content !== "string" || content.trim().length === 0) {
      throw new AppError(400, "Content is required", "PROMPT_CONTENT_REQUIRED");
    }

    const promptId = randomUUID();
    const versionId = randomUUID();

    const [newPrompt] = await db
      .insert(prompts)
      .values({
        id: promptId,
        userId: request.userId!,
        name: name.trim(),
        description: description?.trim() || null,
      })
      .returning();

    const [newVersion] = await db
      .insert(promptVersions)
      .values({
        id: versionId,
        promptId,
        versionNum: 1,
        content: content.trim(),
        model: model || null,
        temperature: temperature ?? null,
      })
      .returning();

    reply.code(201);
    return { ...newPrompt, versions: [newVersion] };
  });

  /**
   * @openapi
   * /prompts/{id}:
   *   get:
   *     summary: Get prompt detail with latest version
   *     description: Returns a single prompt by ID, including its most recent version, for the authenticated user.
   *     tags:
   *       - Prompts
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *         description: Prompt ID
   *     responses:
   *       200:
   *         description: Prompt detail with latest version
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 id:
   *                   type: string
   *                 name:
   *                   type: string
   *                 description:
   *                   type: string
   *                   nullable: true
   *                 createdAt:
   *                   type: string
   *                   format: date-time
   *                 versions:
   *                   type: array
   *                   items:
   *                     $ref: '#/components/schemas/PromptVersion'
   *       401:
   *         description: Unauthorized
   *       404:
   *         description: Prompt not found
   */
  // GET /:id — get prompt detail with latest version
  fastify.get("/:id", { preHandler: fastifyRequireAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };

    const [prompt] = await db
      .select()
      .from(prompts)
      .where(and(eq(prompts.id, id), eq(prompts.userId, request.userId!)));

    if (!prompt) throw new AppError(404, "Prompt not found", "PROMPT_NOT_FOUND");

    const versions = await db
      .select()
      .from(promptVersions)
      .where(eq(promptVersions.promptId, prompt.id))
      .orderBy(desc(promptVersions.versionNum))
      .limit(1);

    return { ...prompt, versions };
  });

  /**
   * @openapi
   * /prompts/{id}:
   *   delete:
   *     summary: Delete a prompt
   *     description: Deletes a prompt and all its versions (cascade) for the authenticated user.
   *     tags:
   *       - Prompts
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *         description: Prompt ID
   *     responses:
   *       200:
   *         description: Prompt deleted successfully
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 success:
   *                   type: boolean
   *                   example: true
   *       401:
   *         description: Unauthorized
   *       404:
   *         description: Prompt not found
   */
  // DELETE /:id — delete prompt (cascades versions)
  fastify.delete("/:id", { preHandler: fastifyRequireAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };

    const [prompt] = await db
      .select()
      .from(prompts)
      .where(and(eq(prompts.id, id), eq(prompts.userId, request.userId!)));

    if (!prompt) throw new AppError(404, "Prompt not found", "PROMPT_NOT_FOUND");

    await db.delete(prompts).where(eq(prompts.id, prompt.id));
    return { success: true };
  });

  /**
   * @openapi
   * /prompts/{id}/versions:
   *   get:
   *     summary: List all versions for a prompt
   *     description: Returns all versions of the specified prompt, ordered by version number descending.
   *     tags:
   *       - Prompts
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *         description: Prompt ID
   *     responses:
   *       200:
   *         description: A list of prompt versions
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 versions:
   *                   type: array
   *                   items:
   *                     $ref: '#/components/schemas/PromptVersion'
   *       401:
   *         description: Unauthorized
   *       404:
   *         description: Prompt not found
   */
  // GET /:id/versions — list all versions for prompt
  fastify.get("/:id/versions", { preHandler: fastifyRequireAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };

    const [prompt] = await db
      .select()
      .from(prompts)
      .where(and(eq(prompts.id, id), eq(prompts.userId, request.userId!)));

    if (!prompt) throw new AppError(404, "Prompt not found", "PROMPT_NOT_FOUND");

    const versions = await db
      .select()
      .from(promptVersions)
      .where(eq(promptVersions.promptId, prompt.id))
      .orderBy(desc(promptVersions.versionNum));

    return { versions };
  });

  /**
   * @openapi
   * /prompts/{id}/versions:
   *   post:
   *     summary: Create a new version for a prompt
   *     description: Adds a new version to the specified prompt. The version number is automatically incremented.
   *     tags:
   *       - Prompts
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *         description: Prompt ID
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required:
   *               - content
   *             properties:
   *               content:
   *                 type: string
   *                 description: Version content text
   *               model:
   *                 type: string
   *                 description: Optional model identifier
   *               temperature:
   *                 type: number
   *                 description: Optional temperature setting
   *               notes:
   *                 type: string
   *                 description: Optional version notes
   *     responses:
   *       201:
   *         description: Version created successfully
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/PromptVersion'
   *       400:
   *         description: Validation error — content missing
   *       401:
   *         description: Unauthorized
   *       404:
   *         description: Prompt not found
   */
  // POST /:id/versions — create new version
  fastify.post("/:id/versions", { preHandler: fastifyRequireAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };

    const [prompt] = await db
      .select()
      .from(prompts)
      .where(and(eq(prompts.id, id), eq(prompts.userId, request.userId!)));

    if (!prompt) throw new AppError(404, "Prompt not found", "PROMPT_NOT_FOUND");

    const { content, model, temperature, notes } = request.body as any;
    if (!content || typeof content !== "string" || content.trim().length === 0) {
      throw new AppError(400, "Content is required", "VERSION_CONTENT_REQUIRED");
    }

    // Get current max versionNum and insert in a transaction to avoid TOCTOU race
    const [version] = await db.transaction(async (tx) => {
      const [latest] = await tx
        .select({ maxVersion: max(promptVersions.versionNum) })
        .from(promptVersions)
        .where(eq(promptVersions.promptId, prompt.id));

      const nextVersion = (latest?.maxVersion ?? 0) + 1;

      return tx
        .insert(promptVersions)
        .values({
          id: randomUUID(),
          promptId: prompt.id,
          versionNum: nextVersion,
          content: content.trim(),
          model: model || null,
          temperature: temperature ?? null,
          notes: notes?.trim() || null,
        })
        .returning();
    });

    reply.code(201);
    return version;
  });

  /**
   * @openapi
   * /prompts/{id}/versions/{versionNum}:
   *   get:
   *     summary: Get a specific version of a prompt
   *     description: Returns a single version of the specified prompt by version number.
   *     tags:
   *       - Prompts
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *         description: Prompt ID
   *       - in: path
   *         name: versionNum
   *         required: true
   *         schema:
   *           type: integer
   *         description: Version number
   *     responses:
   *       200:
   *         description: The prompt version
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/PromptVersion'
   *       400:
   *         description: Invalid version number
   *       401:
   *         description: Unauthorized
   *       404:
   *         description: Prompt or version not found
   */
  // GET /:id/versions/:versionNum — get specific version
  fastify.get("/:id/versions/:versionNum", { preHandler: fastifyRequireAuth }, async (request, reply) => {
    const { id, versionNum: versionNumParam } = request.params as { id: string; versionNum: string };

    const [prompt] = await db
      .select()
      .from(prompts)
      .where(and(eq(prompts.id, id), eq(prompts.userId, request.userId!)));

    if (!prompt) throw new AppError(404, "Prompt not found", "PROMPT_NOT_FOUND");

    const versionNum = parseInt(versionNumParam, 10);
    if (isNaN(versionNum)) {
      throw new AppError(400, "Invalid version number", "INVALID_VERSION_NUM");
    }

    const [version] = await db
      .select()
      .from(promptVersions)
      .where(
        and(
          eq(promptVersions.promptId, prompt.id),
          eq(promptVersions.versionNum, versionNum),
        ),
      );

    if (!version) throw new AppError(404, "Version not found", "VERSION_NOT_FOUND");

    return version;
  });

  /**
   * @openapi
   * /prompts/test:
   *   post:
   *     summary: Test a prompt against an LLM
   *     description: Sends the provided prompt content to an LLM and returns the response along with latency and token usage. Supports a {{input}} placeholder that is replaced with the test_input value.
   *     tags:
   *       - Prompts
   *     security:
   *       - bearerAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required:
   *               - content
   *             properties:
   *               content:
   *                 type: string
   *                 description: Prompt content to test. May contain {{input}} placeholders.
   *               model:
   *                 type: string
   *                 description: Optional model identifier. Defaults to "auto".
   *               temperature:
   *                 type: number
   *                 description: Optional temperature setting
   *               test_input:
   *                 type: string
   *                 description: Optional value to substitute for {{input}} placeholders in the content
   *     responses:
   *       200:
   *         description: LLM response with metadata
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 response:
   *                   type: string
   *                   description: The LLM response text
   *                 latency_ms:
   *                   type: integer
   *                   description: Request latency in milliseconds
   *                 usage:
   *                   type: object
   *                   description: Token usage information
   *       400:
   *         description: Validation error — content missing
   *       401:
   *         description: Unauthorized
   */
  // POST /test — test a prompt against LLM
  fastify.post("/test", { preHandler: fastifyRequireAuth }, async (request, reply) => {
    const { content, model, temperature, test_input } = request.body as any;

    if (!content || typeof content !== "string" || content.trim().length === 0) {
      throw new AppError(400, "Content is required", "TEST_CONTENT_REQUIRED");
    }

    // Replace {{input}} placeholder with test_input if provided
    let resolvedContent = content;
    if (test_input) {
      resolvedContent = resolvedContent.replace(/\{\{input\}\}/g, test_input);
    }

    const startTime = Date.now();

    const result = await routeAndCollect(
      {
        model: model || "auto",
        messages: [{ role: "user", content: resolvedContent }],
        temperature: temperature ?? undefined,
      },
      { preferredModel: model || undefined },
    );

    const latencyMs = Date.now() - startTime;

    return {
      response: result.text,
      latency_ms: latencyMs,
      usage: result.usage,
    };
  });
};

export default promptsPlugin;
