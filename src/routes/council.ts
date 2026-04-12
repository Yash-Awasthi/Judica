import { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { ARCHETYPES, SUMMONS, COUNCIL_TEMPLATES } from "../config/archetypes.js";
import { db } from "../lib/drizzle.js";
import { councilConfigs } from "../db/schema/auth.js";
import { eq } from "drizzle-orm";
import logger from "../lib/logger.js";
import { fastifyRequireAuth } from "../middleware/fastifyAuth.js";
import { AppError } from "../middleware/errorHandler.js";

const updateConfigSchema = z.object({
  customArchetypes: z.array(z.object({
    id: z.string(),
    name: z.string(),
    thinkingStyle: z.string(),
    asks: z.string(),
    blindSpot: z.string(),
    systemPrompt: z.string(),
    tools: z.array(z.string()).optional(),
    icon: z.string().optional(),
    colorBg: z.string().optional(),
  })).optional(),
  defaultSummon: z.string().optional(),
  defaultRounds: z.number().min(1).max(5).optional(),
});

function fastifyValidate(schema: z.ZodSchema) {
  return async (request: any, reply: any) => {
    const result = schema.safeParse(request.body);
    if (!result.success) {
      reply.code(400).send({
        error: "Validation failed",
        details: result.error.issues.map((e: any) => ({
          field: e.path.join("."),
          message: e.message,
        })),
      });
      return;
    }
    request.body = result.data;
  };
}

const councilPlugin: FastifyPluginAsync = async (fastify) => {
  /**
   * @openapi
   * /api/council/archetypes:
   *   get:
   *     tags:
   *       - Council
   *     summary: List all available archetypes
   *     responses:
   *       200:
   *         description: List of archetypes
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 archetypes:
   *                   type: array
   *                   items:
   *                     type: object
   *                     properties:
   *                       id:
   *                         type: string
   *                       name:
   *                         type: string
   *                       thinkingStyle:
   *                         type: string
   *                       asks:
   *                         type: string
   *                       blindSpot:
   *                         type: string
   *                       icon:
   *                         type: string
   *                       colorBg:
   *                         type: string
   */
  fastify.get("/archetypes", async (request, reply) => {
    const archetypes = Object.values(ARCHETYPES).map((a: any) => ({
      id: a.id,
      name: a.name,
      thinkingStyle: a.thinkingStyle,
      asks: a.asks,
      blindSpot: a.blindSpot,
      icon: a.icon,
      colorBg: a.colorBg,
    }));
    return { archetypes };
  });

  /**
   * @openapi
   * /api/council/summons:
   *   get:
   *     tags:
   *       - Council
   *     summary: List all available summon configurations
   *     responses:
   *       200:
   *         description: List of summons
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 summons:
   *                   type: array
   *                   items:
   *                     type: object
   */
  fastify.get("/summons", async (request, reply) => {
    return { summons: SUMMONS };
  });

  /**
   * @openapi
   * /api/council/templates:
   *   get:
   *     tags:
   *       - Council
   *     summary: List council templates
   *     responses:
   *       200:
   *         description: List of council templates
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 templates:
   *                   type: array
   *                   items:
   *                     type: object
   */
  fastify.get("/templates", async (request, reply) => {
    return { templates: COUNCIL_TEMPLATES };
  });

  /**
   * @openapi
   * /api/council/config:
   *   get:
   *     tags:
   *       - Council
   *     summary: Get the user's council configuration
   *     security:
   *       - bearerAuth: []
   *     responses:
   *       200:
   *         description: Council configuration
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 config:
   *                   type: object
   *                   nullable: true
   *       401:
   *         description: Unauthorized
   *       500:
   *         description: Failed to get council config
   */
  fastify.get("/config", { preHandler: fastifyRequireAuth }, async (request, reply) => {
    try {
      const userId = request.userId!;
      const [config] = await db
        .select()
        .from(councilConfigs)
        .where(eq(councilConfigs.userId, userId))
        .limit(1);
      return { config: config?.config || null };
    } catch (err) {
      logger.error({ err: (err as Error).message }, "Failed to get council config");
      throw new AppError(500, "Failed to get council config", "COUNCIL_CONFIG_FETCH_FAILED");
    }
  });

  /**
   * @openapi
   * /api/council/config:
   *   put:
   *     tags:
   *       - Council
   *     summary: Update the user's council configuration
   *     security:
   *       - bearerAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               customArchetypes:
   *                 type: array
   *                 items:
   *                   type: object
   *                   required:
   *                     - id
   *                     - name
   *                     - thinkingStyle
   *                     - asks
   *                     - blindSpot
   *                     - systemPrompt
   *                   properties:
   *                     id:
   *                       type: string
   *                     name:
   *                       type: string
   *                     thinkingStyle:
   *                       type: string
   *                     asks:
   *                       type: string
   *                     blindSpot:
   *                       type: string
   *                     systemPrompt:
   *                       type: string
   *                     tools:
   *                       type: array
   *                       items:
   *                         type: string
   *                     icon:
   *                       type: string
   *                     colorBg:
   *                       type: string
   *               defaultSummon:
   *                 type: string
   *               defaultRounds:
   *                 type: integer
   *                 minimum: 1
   *                 maximum: 5
   *     responses:
   *       200:
   *         description: Updated council configuration
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 config:
   *                   type: object
   *       401:
   *         description: Unauthorized
   *       500:
   *         description: Failed to update council config
   */
  fastify.put("/config", { preHandler: [fastifyRequireAuth, fastifyValidate(updateConfigSchema)] }, async (request, reply) => {
    try {
      const userId = request.userId!;
      const config = request.body;

      // Try update first, then insert if not found (upsert)
      const [existing] = await db
        .select({ id: councilConfigs.id })
        .from(councilConfigs)
        .where(eq(councilConfigs.userId, userId))
        .limit(1);

      let updated;
      if (existing) {
        [updated] = await db
          .update(councilConfigs)
          .set({ config, updatedAt: new Date() })
          .where(eq(councilConfigs.userId, userId))
          .returning();
      } else {
        [updated] = await db
          .insert(councilConfigs)
          .values({ userId, config, updatedAt: new Date() } as any)
          .returning();
      }

      return { config: updated.config };
    } catch (err) {
      logger.error({ err: (err as Error).message }, "Failed to update council config");
      throw new AppError(500, "Failed to update council config", "COUNCIL_CONFIG_UPDATE_FAILED");
    }
  });

  /**
   * @openapi
   * /api/council/config:
   *   delete:
   *     tags:
   *       - Council
   *     summary: Delete the user's council configuration
   *     security:
   *       - bearerAuth: []
   *     responses:
   *       200:
   *         description: Council config deleted
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 message:
   *                   type: string
   *       401:
   *         description: Unauthorized
   *       500:
   *         description: Failed to delete council config
   */
  fastify.delete("/config", { preHandler: fastifyRequireAuth }, async (request, reply) => {
    try {
      const userId = request.userId!;
      await db.delete(councilConfigs).where(eq(councilConfigs.userId, userId));
      return { message: "Council config deleted" };
    } catch (err) {
      logger.error({ err: (err as Error).message }, "Failed to delete council config");
      throw new AppError(500, "Failed to delete council config", "COUNCIL_CONFIG_DELETE_FAILED");
    }
  });

  /**
   * @openapi
   * /api/council/archetypes/{id}:
   *   get:
   *     tags:
   *       - Council
   *     summary: Get a specific archetype by ID
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *         description: Archetype ID
   *     responses:
   *       200:
   *         description: Archetype details
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 archetype:
   *                   type: object
   *       404:
   *         description: Archetype not found
   */
  fastify.get("/archetypes/:id", async (request, reply) => {
    const { id } = request.params as any;
    const archetype = ARCHETYPES[String(id)];

    if (!archetype) {
      reply.code(404);
      return { error: "Archetype not found" };
    }

    return { archetype };
  });
};

export default councilPlugin;
