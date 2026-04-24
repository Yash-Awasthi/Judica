/**
 * Standard Answers — Routes
 *
 * REST API for admin management of standard answers.
 */

import type { FastifyPluginAsync } from "fastify";
import { fastifyRequireAuth } from "../middleware/fastifyAuth.js";
import { AppError } from "../middleware/errorHandler.js";
import {
  createStandardAnswer,
  listStandardAnswers,
  updateStandardAnswer,
  deleteStandardAnswer,
  matchQuery,
} from "../services/standardAnswer.service.js";

const standardAnswersPlugin: FastifyPluginAsync = async (fastify) => {
  // GET / — list all standard answers
  fastify.get("/", { preHandler: fastifyRequireAuth }, async () => {
    const answers = await listStandardAnswers();
    return { answers };
  });

  // POST / — create a standard answer
  fastify.post("/", { preHandler: fastifyRequireAuth }, async (request, reply) => {
    const body = request.body as {
      title?: string;
      answer?: string;
      categories?: string[];
      priority?: number;
      rules?: Array<{ type: string; value: string; threshold?: number; matchAll?: boolean }>;
    };

    if (!body.title || !body.answer) {
      throw new AppError(400, "Title and answer are required", "STANDARD_ANSWER_REQUIRED");
    }

    const rules = (body.rules || []).map((r) => ({
      type: r.type as "keyword" | "regex" | "semantic",
      value: r.value,
      threshold: r.threshold,
      matchAll: r.matchAll,
    }));

    const result = await createStandardAnswer(
      { title: body.title, answer: body.answer, categories: body.categories, priority: body.priority, rules },
      request.userId!,
    );

    reply.code(201);
    return result;
  });

  // PUT /:id — update a standard answer
  fastify.put("/:id", { preHandler: fastifyRequireAuth }, async (request) => {
    const { id } = request.params as { id: string };
    const body = request.body as Partial<{ title: string; answer: string; enabled: boolean; categories: string[]; priority: number }>;

    await updateStandardAnswer(id, body);
    return { success: true };
  });

  // DELETE /:id — delete a standard answer
  fastify.delete("/:id", { preHandler: fastifyRequireAuth }, async (request) => {
    const { id } = request.params as { id: string };
    await deleteStandardAnswer(id);
    return { success: true };
  });

  // POST /match — test a query against standard answers
  fastify.post("/match", { preHandler: fastifyRequireAuth }, async (request) => {
    const { query } = request.body as { query?: string };
    if (!query) {
      throw new AppError(400, "Query is required", "MATCH_QUERY_REQUIRED");
    }

    const match = await matchQuery(query);
    return { match };
  });
};

export default standardAnswersPlugin;
