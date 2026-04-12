import { FastifyPluginAsync } from "fastify";
import { randomUUID } from "crypto";
import { db } from "../lib/drizzle.js";
import { customPersonas } from "../db/schema/council.js";
import { eq, and, desc } from "drizzle-orm";
import { fastifyRequireAuth } from "../middleware/fastifyAuth.js";
import { AppError } from "../middleware/errorHandler.js";
import { BUILT_IN_PERSONAS } from "../agents/personas.js";

const personasPlugin: FastifyPluginAsync = async (fastify) => {
  /**
   * @openapi
   * /api/personas:
   *   get:
   *     tags:
   *       - Personas
   *     summary: List built-in and custom personas
   *     security:
   *       - bearerAuth: []
   *     responses:
   *       200:
   *         description: List of personas
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 personas:
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
   *                       temperature:
   *                         type: number
   *                       critiqueStyle:
   *                         type: string
   *                         nullable: true
   *                       domain:
   *                         type: string
   *                         nullable: true
   *                       aggressiveness:
   *                         type: integer
   *                       isBuiltIn:
   *                         type: boolean
   *       401:
   *         description: Unauthorized
   */
  // GET / — list built-in + user's custom personas
  fastify.get("/", { preHandler: fastifyRequireAuth }, async (request, reply) => {
    const custom = await db
      .select()
      .from(customPersonas)
      .where(eq(customPersonas.userId, request.userId!))
      .orderBy(desc(customPersonas.createdAt));

    const customMapped = custom.map((p) => ({
      id: p.id,
      name: p.name,
      systemPrompt: p.systemPrompt,
      temperature: p.temperature,
      critiqueStyle: p.critiqueStyle,
      domain: p.domain,
      aggressiveness: p.aggressiveness,
      isBuiltIn: false,
      createdAt: p.createdAt,
    }));

    return { personas: [...BUILT_IN_PERSONAS, ...customMapped] };
  });

  /**
   * @openapi
   * /api/personas:
   *   post:
   *     tags:
   *       - Personas
   *     summary: Create a custom persona
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
   *               temperature:
   *                 type: number
   *                 default: 0.7
   *               critiqueStyle:
   *                 type: string
   *                 nullable: true
   *               domain:
   *                 type: string
   *                 nullable: true
   *               aggressiveness:
   *                 type: integer
   *                 default: 5
   *     responses:
   *       201:
   *         description: Created persona
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *       400:
   *         description: Missing required fields
   *       401:
   *         description: Unauthorized
   */
  // POST / — create custom persona
  fastify.post("/", { preHandler: fastifyRequireAuth }, async (request, reply) => {
    const { name, systemPrompt, temperature, critiqueStyle, domain, aggressiveness } =
      request.body as Record<string, any>;

    if (!name || typeof name !== "string" || name.trim().length === 0) {
      throw new AppError(400, "Name is required", "PERSONA_NAME_REQUIRED");
    }
    if (!systemPrompt || typeof systemPrompt !== "string" || systemPrompt.trim().length === 0) {
      throw new AppError(400, "System prompt is required", "PERSONA_PROMPT_REQUIRED");
    }

    const [persona] = await db
      .insert(customPersonas)
      .values({
        id: randomUUID(),
        userId: request.userId!,
        name: name.trim(),
        systemPrompt: systemPrompt.trim(),
        temperature: temperature ?? 0.7,
        critiqueStyle: critiqueStyle || null,
        domain: domain || null,
        aggressiveness: aggressiveness ?? 5,
      })
      .returning();

    reply.code(201);
    return persona;
  });

  /**
   * @openapi
   * /api/personas/{id}:
   *   put:
   *     tags:
   *       - Personas
   *     summary: Update a custom persona
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *         description: Persona ID
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
   *               temperature:
   *                 type: number
   *               critiqueStyle:
   *                 type: string
   *               domain:
   *                 type: string
   *               aggressiveness:
   *                 type: integer
   *     responses:
   *       200:
   *         description: Updated persona
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *       401:
   *         description: Unauthorized
   *       404:
   *         description: Persona not found
   */
  // PUT /:id — update custom persona
  fastify.put("/:id", { preHandler: fastifyRequireAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };

    const [existing] = await db
      .select()
      .from(customPersonas)
      .where(and(eq(customPersonas.id, id), eq(customPersonas.userId, request.userId!)))
      .limit(1);

    if (!existing) throw new AppError(404, "Persona not found", "PERSONA_NOT_FOUND");

    const { name, systemPrompt, temperature, critiqueStyle, domain, aggressiveness } =
      request.body as Record<string, any>;

    const data: Record<string, unknown> = {};
    if (name !== undefined) data.name = name.trim();
    if (systemPrompt !== undefined) data.systemPrompt = systemPrompt.trim();
    if (temperature !== undefined) data.temperature = temperature;
    if (critiqueStyle !== undefined) data.critiqueStyle = critiqueStyle;
    if (domain !== undefined) data.domain = domain;
    if (aggressiveness !== undefined) data.aggressiveness = aggressiveness;

    const [updated] = await db
      .update(customPersonas)
      .set(data)
      .where(eq(customPersonas.id, existing.id))
      .returning();

    return updated;
  });

  /**
   * @openapi
   * /api/personas/{id}:
   *   delete:
   *     tags:
   *       - Personas
   *     summary: Delete a custom persona
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *         description: Persona ID
   *     responses:
   *       200:
   *         description: Persona deleted
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
   *         description: Persona not found
   */
  // DELETE /:id — delete custom persona
  fastify.delete("/:id", { preHandler: fastifyRequireAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };

    const [existing] = await db
      .select()
      .from(customPersonas)
      .where(and(eq(customPersonas.id, id), eq(customPersonas.userId, request.userId!)))
      .limit(1);

    if (!existing) throw new AppError(404, "Persona not found", "PERSONA_NOT_FOUND");

    await db.delete(customPersonas).where(eq(customPersonas.id, existing.id));
    return { success: true };
  });
};

export default personasPlugin;
