import type { FastifyPluginAsync } from "fastify";
import { randomUUID } from "crypto";
import { db } from "../lib/drizzle.js";
import { promptDnas } from "../db/schema/council.js";
import { eq, and, desc } from "drizzle-orm";
import { fastifyRequireAuth } from "../middleware/fastifyAuth.js";
import { AppError } from "../middleware/errorHandler.js";

const VALID_CONSENSUS_BIAS = ["neutral", "creative", "analytical", "conservative"];
const VALID_CRITIQUE_STYLE = ["evidence_based", "constructive", "adversarial"];

function validateConsensusBias(value: string): void {
  if (!VALID_CONSENSUS_BIAS.includes(value) && value.length > 100) {
    throw new AppError(400, `consensusBias must be one of ${VALID_CONSENSUS_BIAS.join(", ")} or at most 100 characters`, "DNA_INVALID_CONSENSUS_BIAS");
  }
}

function validateCritiqueStyle(value: string): void {
  if (!VALID_CRITIQUE_STYLE.includes(value) && value.length > 100) {
    throw new AppError(400, `critiqueStyle must be one of ${VALID_CRITIQUE_STYLE.join(", ")} or at most 100 characters`, "DNA_INVALID_CRITIQUE_STYLE");
  }
}

const promptDnaPlugin: FastifyPluginAsync = async (fastify) => {
    // GET / — list user's PromptDNA profiles
  fastify.get("/", { preHandler: fastifyRequireAuth }, async (request, _reply) => {
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
      request.body as { name?: string; systemPrompt?: string; steeringRules?: string; consensusBias?: string; critiqueStyle?: string };

    if (!name || typeof name !== "string") {
      throw new AppError(400, "Name is required", "DNA_NAME_REQUIRED");
    }
    if (name.length > 200) {
      throw new AppError(400, "Name must be at most 200 characters", "DNA_NAME_TOO_LONG");
    }
    if (!systemPrompt || typeof systemPrompt !== "string") {
      throw new AppError(400, "System prompt is required", "DNA_PROMPT_REQUIRED");
    }
    if (systemPrompt.length > 10_000) {
      throw new AppError(400, "System prompt must be at most 10,000 characters", "DNA_PROMPT_TOO_LONG");
    }
    if (steeringRules && steeringRules.length > 5_000) {
      throw new AppError(400, "Steering rules must be at most 5,000 characters", "DNA_STEERING_RULES_TOO_LONG");
    }
    if (consensusBias) validateConsensusBias(consensusBias);
    if (critiqueStyle) validateCritiqueStyle(critiqueStyle);

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
  fastify.put("/:id", { preHandler: fastifyRequireAuth }, async (request, _reply) => {
    const { id } = request.params as { id: string };

    const [existing] = await db
      .select()
      .from(promptDnas)
      .where(and(eq(promptDnas.id, id), eq(promptDnas.userId, request.userId!)))
      .limit(1);

    if (!existing) throw new AppError(404, "PromptDNA not found", "DNA_NOT_FOUND");

    const { name, systemPrompt, steeringRules, consensusBias, critiqueStyle } =
      request.body as { name?: string; systemPrompt?: string; steeringRules?: string; consensusBias?: string; critiqueStyle?: string };

    const data: Record<string, unknown> = {};
    if (name !== undefined) {
      if (name.length > 200) {
        throw new AppError(400, "Name must be at most 200 characters", "DNA_NAME_TOO_LONG");
      }
      data.name = name.trim();
    }
    if (systemPrompt !== undefined) {
      if (systemPrompt.length > 10_000) {
        throw new AppError(400, "System prompt must be at most 10,000 characters", "DNA_PROMPT_TOO_LONG");
      }
      data.systemPrompt = systemPrompt.trim();
    }
    if (steeringRules !== undefined) {
      if (steeringRules.length > 5_000) {
        throw new AppError(400, "Steering rules must be at most 5,000 characters", "DNA_STEERING_RULES_TOO_LONG");
      }
      data.steeringRules = steeringRules.trim();
    }
    if (consensusBias !== undefined) {
      validateConsensusBias(consensusBias);
      data.consensusBias = consensusBias;
    }
    if (critiqueStyle !== undefined) {
      validateCritiqueStyle(critiqueStyle);
      data.critiqueStyle = critiqueStyle;
    }

    const [updated] = await db
      .update(promptDnas)
      .set(data)
      .where(eq(promptDnas.id, existing.id))
      .returning();

    return updated;
  });

    // DELETE /:id — delete PromptDNA
  fastify.delete("/:id", { preHandler: fastifyRequireAuth }, async (request, _reply) => {
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
