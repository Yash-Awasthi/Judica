import { FastifyPluginAsync } from "fastify";
import { randomUUID } from "crypto";
import { db } from "../lib/drizzle.js";
import { promptDnas } from "../db/schema/council.js";
import { eq, and, desc } from "drizzle-orm";
import { fastifyRequireAuth } from "../middleware/fastifyAuth.js";
import { AppError } from "../middleware/errorHandler.js";

const promptDnaPlugin: FastifyPluginAsync = async (fastify) => {
  /**
   * @openapi
   * /api/prompt-dna:
   *   get:
   *     tags:
   *       - Personas
   *     summary: List user's PromptDNA profiles
   *     security:
   *       - bearerAuth: []
   *     responses:
   *       200:
   *         description: List of PromptDNA profiles
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 dnas:
   *                   type: array
   *                   items:
   *                     type: object
   *                     properties:
   *                       id:
   *                         type: string
   *                       name:
   *                         type: string
   *                       systemPrompt:
   *                         type: string
   *                       steeringRules:
   *                         type: string
   *                       consensusBias:
   *                         type: string
   *                       critiqueStyle:
   *                         type: string
   *                       createdAt:
   *                         type: string
   *                         format: date-time
   *       401:
   *         description: Unauthorized
   */
  // GET / — list user's PromptDNA profiles
  fastify.get("/", { preHandler: fastifyRequireAuth }, async (request, reply) => {
    const dnas = await db
      .select()
      .from(promptDnas)
      .where(eq(promptDnas.userId, request.userId!))
      .orderBy(desc(promptDnas.createdAt));

    return { dnas };
  });

  /**
   * @openapi
   * /api/prompt-dna:
   *   post:
   *     tags:
   *       - Personas
   *     summary: Create a PromptDNA profile
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
   *               - systemPrompt
   *             properties:
   *               name:
   *                 type: string
   *               systemPrompt:
   *                 type: string
   *               steeringRules:
   *                 type: string
   *               consensusBias:
   *                 type: string
   *                 default: neutral
   *               critiqueStyle:
   *                 type: string
   *                 default: evidence_based
   *     responses:
   *       201:
   *         description: Created PromptDNA
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *       400:
   *         description: Missing required fields
   *       401:
   *         description: Unauthorized
   */
  // POST / — create PromptDNA
  fastify.post("/", { preHandler: fastifyRequireAuth }, async (request, reply) => {
    const { name, systemPrompt, steeringRules, consensusBias, critiqueStyle } =
      request.body as Record<string, any>;

    if (!name || typeof name !== "string") {
      throw new AppError(400, "Name is required", "DNA_NAME_REQUIRED");
    }
    if (!systemPrompt || typeof systemPrompt !== "string") {
      throw new AppError(400, "System prompt is required", "DNA_PROMPT_REQUIRED");
    }

    const [dna] = await db
      .insert(promptDnas)
      .values({
        id: randomUUID(),
        userId: request.userId!,
        name: name.trim(),
        systemPrompt: systemPrompt.trim(),
        steeringRules: steeringRules?.trim() || "",
        consensusBias: consensusBias || "neutral",
        critiqueStyle: critiqueStyle || "evidence_based",
      })
      .returning();

    reply.code(201);
    return dna;
  });

  /**
   * @openapi
   * /api/prompt-dna/{id}:
   *   put:
   *     tags:
   *       - Personas
   *     summary: Update a PromptDNA profile
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *         description: PromptDNA ID
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               name:
   *                 type: string
   *               systemPrompt:
   *                 type: string
   *               steeringRules:
   *                 type: string
   *               consensusBias:
   *                 type: string
   *               critiqueStyle:
   *                 type: string
   *     responses:
   *       200:
   *         description: Updated PromptDNA
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *       401:
   *         description: Unauthorized
   *       404:
   *         description: PromptDNA not found
   */
  // PUT /:id — update PromptDNA
  fastify.put("/:id", { preHandler: fastifyRequireAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };

    const [existing] = await db
      .select()
      .from(promptDnas)
      .where(and(eq(promptDnas.id, id), eq(promptDnas.userId, request.userId!)))
      .limit(1);

    if (!existing) throw new AppError(404, "PromptDNA not found", "DNA_NOT_FOUND");

    const { name, systemPrompt, steeringRules, consensusBias, critiqueStyle } =
      request.body as Record<string, any>;

    const data: Record<string, unknown> = {};
    if (name !== undefined) data.name = name.trim();
    if (systemPrompt !== undefined) data.systemPrompt = systemPrompt.trim();
    if (steeringRules !== undefined) data.steeringRules = steeringRules.trim();
    if (consensusBias !== undefined) data.consensusBias = consensusBias;
    if (critiqueStyle !== undefined) data.critiqueStyle = critiqueStyle;

    const [updated] = await db
      .update(promptDnas)
      .set(data)
      .where(eq(promptDnas.id, existing.id))
      .returning();

    return updated;
  });

  /**
   * @openapi
   * /api/prompt-dna/{id}:
   *   delete:
   *     tags:
   *       - Personas
   *     summary: Delete a PromptDNA profile
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *         description: PromptDNA ID
   *     responses:
   *       200:
   *         description: PromptDNA deleted
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
   *         description: PromptDNA not found
   */
  // DELETE /:id — delete PromptDNA
  fastify.delete("/:id", { preHandler: fastifyRequireAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };

    const [existing] = await db
      .select()
      .from(promptDnas)
      .where(and(eq(promptDnas.id, id), eq(promptDnas.userId, request.userId!)))
      .limit(1);

    if (!existing) throw new AppError(404, "PromptDNA not found", "DNA_NOT_FOUND");

    await db.delete(promptDnas).where(eq(promptDnas.id, existing.id));
    return { success: true };
  });
};

export default promptDnaPlugin;
