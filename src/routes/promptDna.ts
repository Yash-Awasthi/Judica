import { FastifyPluginAsync } from "fastify";
import { randomUUID } from "crypto";
import { db } from "../lib/drizzle.js";
import { promptDnas } from "../db/schema/council.js";
import { eq, and, desc } from "drizzle-orm";
import { fastifyRequireAuth } from "../middleware/fastifyAuth.js";
import { AppError } from "../middleware/errorHandler.js";

const promptDnaPlugin: FastifyPluginAsync = async (fastify) => {
    // GET / — list user's PromptDNA profiles
  fastify.get("/", { preHandler: fastifyRequireAuth }, async (request, reply) => {
    const dnas = await db
      .select()
      .from(promptDnas)
      .where(eq(promptDnas.userId, request.userId!))
      .orderBy(desc(promptDnas.createdAt));

    return { dnas };
  });

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
