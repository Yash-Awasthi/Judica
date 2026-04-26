/**
 * HuggingFace Hub routes — Phase 2.15
 *
 * Search HF Hub and invoke models as council tools.
 * Integrates with the existing openapiTools infrastructure.
 */

import { FastifyInstance } from "fastify";
import { fetchHFSpaceInfo, fetchHFModelInfo, invokeHFInference, searchHFModels } from "../lib/hfHub.js";
import { db } from "../lib/drizzle.js";
import { openapiTools } from "../db/schema/openapiTools.js";
import { z } from "zod";

const invokeSchema = z.object({
  modelId:    z.string().min(1),
  inputs:     z.unknown(),
  parameters: z.record(z.unknown()).optional(),
});

const registerSchema = z.object({
  modelId:     z.string().min(1),
  name:        z.string().optional(),
  description: z.string().optional(),
});

export async function hfHubPlugin(app: FastifyInstance) {
  // GET /hf/search?pipeline=text-classification&limit=10 — search models
  app.get("/hf/search", async (req, reply) => {
    const { pipeline = "text-classification", limit = "10" } = req.query as Record<string, string>;
    const models = await searchHFModels(pipeline, Math.min(Number(limit) || 10, 50));
    return { success: true, models };
  });

  // GET /hf/models/:modelId — fetch model metadata
  app.get("/hf/models/:modelId", async (req, reply) => {
    const modelId = (req.params as any).modelId as string;
    const info = await fetchHFModelInfo(decodeURIComponent(modelId));
    if (!info) return reply.status(404).send({ error: "Model not found" });
    return { success: true, model: info };
  });

  // GET /hf/spaces/:spaceId — fetch space metadata
  app.get("/hf/spaces/:spaceId", async (req, reply) => {
    const spaceId = (req.params as any).spaceId as string;
    const info = await fetchHFSpaceInfo(decodeURIComponent(spaceId));
    if (!info) return reply.status(404).send({ error: "Space not found" });
    return { success: true, space: info };
  });

  // POST /hf/invoke — invoke a model via HF Inference API
  app.post("/hf/invoke", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const parsed = invokeSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });

    const { modelId, inputs, parameters } = parsed.data;
    const output = await invokeHFInference(modelId, inputs, parameters);
    return { success: true, output };
  });

  // POST /hf/register — register a HF model as an openapiTool entry
  app.post("/hf/register", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });

    const { modelId, name, description } = parsed.data;

    // Fetch metadata to pre-fill fields
    const modelInfo = await fetchHFModelInfo(modelId);

    const [tool] = await db
      .insert(openapiTools)
      .values({
        userId,
        name:        name ?? modelInfo?.id ?? modelId,
        description: description ?? modelInfo?.description ?? `HuggingFace model: ${modelId}`,
        method:      "POST",
        url:         `https://api-inference.huggingface.co/models/${modelId}`,
        parameters:  { inputs: { type: "string", description: "Model input" } },
        meta:        {
          source:       "huggingface",
          modelId,
          pipelineTag:  modelInfo?.pipeline_tag ?? "unknown",
          authHeader:   "Bearer ${HUGGINGFACE_TOKEN}",
        },
      })
      .returning();

    return reply.status(201).send({ success: true, tool });
  });
}
