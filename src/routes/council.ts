import { FastifyPluginAsync, FastifyRequest, FastifyReply } from "fastify";
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
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const result = schema.safeParse(request.body);
    if (!result.success) {
      reply.code(400).send({
        error: "Validation failed",
        details: result.error.issues.map((e) => ({
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
    fastify.get("/archetypes", async (_request, _reply) => {
    const archetypes = Object.values(ARCHETYPES).map((a) => ({
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

    fastify.get("/summons", async (_request, _reply) => {
    return { summons: SUMMONS };
  });

    fastify.get("/templates", async (_request, _reply) => {
    return { templates: COUNCIL_TEMPLATES };
  });

    fastify.get("/config", { preHandler: fastifyRequireAuth }, async (request, _reply) => {
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

    fastify.put("/config", { preHandler: [fastifyRequireAuth, fastifyValidate(updateConfigSchema)] }, async (request, _reply) => {
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
          .values({ userId, config, updatedAt: new Date() } as typeof councilConfigs.$inferInsert)
          .returning();
      }

      return { config: updated.config };
    } catch (err) {
      logger.error({ err: (err as Error).message }, "Failed to update council config");
      throw new AppError(500, "Failed to update council config", "COUNCIL_CONFIG_UPDATE_FAILED");
    }
  });

    fastify.delete("/config", { preHandler: fastifyRequireAuth }, async (request, _reply) => {
    try {
      const userId = request.userId!;
      await db.delete(councilConfigs).where(eq(councilConfigs.userId, userId));
      return { message: "Council config deleted" };
    } catch (err) {
      logger.error({ err: (err as Error).message }, "Failed to delete council config");
      throw new AppError(500, "Failed to delete council config", "COUNCIL_CONFIG_DELETE_FAILED");
    }
  });

    fastify.get("/archetypes/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const archetype = ARCHETYPES[String(id)];

    if (!archetype) {
      reply.code(404);
      return { error: "Archetype not found" };
    }

    return { archetype };
  });
};

export default councilPlugin;
