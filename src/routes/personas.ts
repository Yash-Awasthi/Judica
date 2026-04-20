import type { FastifyPluginAsync } from "fastify";
import { randomUUID } from "crypto";
import { db } from "../lib/drizzle.js";
import { customPersonas } from "../db/schema/council.js";
import { eq, and, desc } from "drizzle-orm";
import { fastifyRequireAuth } from "../middleware/fastifyAuth.js";
import { AppError } from "../middleware/errorHandler.js";
import { BUILT_IN_PERSONAS } from "../agents/personas.js";

const personasPlugin: FastifyPluginAsync = async (fastify) => {
    // GET / — list built-in + user's custom personas
  fastify.get("/", { preHandler: fastifyRequireAuth }, async (request, _reply) => {
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

    // POST / — create custom persona
  fastify.post("/", { preHandler: fastifyRequireAuth }, async (request, reply) => {
    const { name, systemPrompt, temperature, critiqueStyle, domain, aggressiveness } =
      request.body as { name?: string; systemPrompt?: string; temperature?: number; critiqueStyle?: string; domain?: string; aggressiveness?: number };

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

    // PUT /:id — update custom persona
  fastify.put("/:id", { preHandler: fastifyRequireAuth }, async (request, _reply) => {
    const { id } = request.params as { id: string };

    const [existing] = await db
      .select()
      .from(customPersonas)
      .where(and(eq(customPersonas.id, id), eq(customPersonas.userId, request.userId!)))
      .limit(1);

    if (!existing) throw new AppError(404, "Persona not found", "PERSONA_NOT_FOUND");

    const { name, systemPrompt, temperature, critiqueStyle, domain, aggressiveness } =
      request.body as { name?: string; systemPrompt?: string; temperature?: number; critiqueStyle?: string; domain?: string; aggressiveness?: number };

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

    // DELETE /:id — delete custom persona
  fastify.delete("/:id", { preHandler: fastifyRequireAuth }, async (request, _reply) => {
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
