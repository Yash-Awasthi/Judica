/**
 * Fine-Tune Pipeline routes — Phase 2.11
 *
 * Export rated council responses as JSONL training data.
 * Optionally initiate an OpenAI fine-tune job (user-triggered, never automatic).
 *
 * Inspired by DSPy self-improving pipeline concept.
 */

import { FastifyInstance } from "fastify";
import { buildFineTuneDataset, serializeAsJSONL, initiateFineTuneJob } from "../lib/fineTunePipeline.js";
import { z } from "zod";

const initiateSchema = z.object({
  baseModel: z.string().optional(),
});

export async function fineTunePlugin(app: FastifyInstance) {
  // GET /fine-tune/dataset — preview dataset stats + eligibility
  app.get("/fine-tune/dataset", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const dataset = await buildFineTuneDataset(userId);
    return {
      success:  true,
      count:    dataset.count,
      eligible: dataset.eligible,
      message:  dataset.eligible
        ? `Ready to fine-tune with ${dataset.count} examples.`
        : `Need at least 50 rated responses (have ${dataset.count}).`,
    };
  });

  // GET /fine-tune/export — download JSONL training file
  app.get("/fine-tune/export", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const dataset = await buildFineTuneDataset(userId);
    if (!dataset.eligible) {
      return reply.status(422).send({
        error: `Insufficient data — need ${50 - dataset.count} more rated responses.`,
      });
    }

    const jsonl = serializeAsJSONL(dataset);
    reply.header("Content-Type", "application/jsonl");
    reply.header("Content-Disposition", "attachment; filename=aibyai-finetune.jsonl");
    return reply.send(jsonl);
  });

  // POST /fine-tune/initiate — trigger OpenAI fine-tune job (user-initiated only)
  app.post("/fine-tune/initiate", async (req, reply) => {
    const userId = (req as any).userId as number | undefined;
    if (!userId) return reply.status(401).send({ error: "Unauthorized" });

    const parsed = initiateSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });

    const dataset = await buildFineTuneDataset(userId);
    if (!dataset.eligible) {
      return reply.status(422).send({
        error: `Insufficient data — need ${50 - dataset.count} more rated responses.`,
      });
    }

    const jsonl = serializeAsJSONL(dataset);
    const result = await initiateFineTuneJob(jsonl, parsed.data.baseModel);

    return { success: true, ...result, exampleCount: dataset.count };
  });
}
