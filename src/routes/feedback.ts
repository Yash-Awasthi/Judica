import type { FastifyPluginAsync } from "fastify";
import { fastifyRequireAuth, fastifyRequireAdmin } from "../middleware/fastifyAuth.js";
import { AppError } from "../middleware/errorHandler.js";
import {
  submitResponseFeedback,
  submitSearchFeedback,
  getFeedbackStats,
  exportFeedback,
} from "../services/feedback.service.js";

const feedbackPlugin: FastifyPluginAsync = async (fastify) => {
  // POST /api/feedback/response — submit thumbs up/down on an AI response (auth required)
  fastify.post("/response", { preHandler: [fastifyRequireAuth] }, async (request, reply) => {
    const {
      conversationId,
      messageIndex,
      rating,
      feedbackText,
      qualityIssues,
      selectedText,
      improvedAnswer,
      documentIds,
    } = request.body as {
      conversationId?: string;
      messageIndex?: number;
      rating?: string;
      feedbackText?: string;
      qualityIssues?: string[];
      selectedText?: string;
      improvedAnswer?: string;
      documentIds?: string[];
    };

    if (!conversationId || typeof conversationId !== "string") {
      throw new AppError(400, "conversationId is required");
    }
    if (typeof messageIndex !== "number") {
      throw new AppError(400, "messageIndex is required and must be a number");
    }
    if (rating !== "positive" && rating !== "negative") {
      throw new AppError(400, "rating must be 'positive' or 'negative'");
    }

    const result = await submitResponseFeedback({
      conversationId,
      messageIndex,
      userId: request.userId!,
      rating,
      feedbackText,
      qualityIssues,
      selectedText,
      improvedAnswer,
      documentIds,
    });

    reply.code(201);
    return result;
  });

  // POST /api/feedback/search — mark search result as relevant/irrelevant (auth required)
  fastify.post("/search", { preHandler: [fastifyRequireAuth] }, async (request, reply) => {
    const { query, documentId, isRelevant, tenantId } = request.body as {
      query?: string;
      documentId?: string;
      isRelevant?: boolean;
      tenantId?: string;
    };

    if (!query || typeof query !== "string") {
      throw new AppError(400, "query is required");
    }
    if (!documentId || typeof documentId !== "string") {
      throw new AppError(400, "documentId is required");
    }
    if (typeof isRelevant !== "boolean") {
      throw new AppError(400, "isRelevant must be a boolean");
    }

    const result = await submitSearchFeedback({
      query,
      documentId,
      userId: request.userId!,
      isRelevant,
      tenantId,
    });

    reply.code(201);
    return result;
  });

  // GET /api/feedback/stats — aggregate stats (admin required)
  fastify.get("/stats", { preHandler: [fastifyRequireAdmin] }, async (request, _reply) => {
    const { tenantId, from, to } = request.query as {
      tenantId?: string;
      from?: string;
      to?: string;
    };

    const dateRange = {
      from: from ? new Date(from) : undefined,
      to: to ? new Date(to) : undefined,
    };

    return getFeedbackStats(tenantId, dateRange);
  });

  // GET /api/feedback/export — export feedback data for fine-tuning (admin required)
  fastify.get("/export", { preHandler: [fastifyRequireAdmin] }, async (request, reply) => {
    const { tenantId, format = "json" } = request.query as {
      tenantId?: string;
      format?: string;
    };

    if (format !== "json" && format !== "csv") {
      throw new AppError(400, "format must be 'json' or 'csv'");
    }

    const data = await exportFeedback(tenantId, format);

    if (format === "csv") {
      reply.header("Content-Type", "text/csv");
      reply.header("Content-Disposition", "attachment; filename=feedback-export.csv");
    } else {
      reply.header("Content-Type", "application/json");
    }

    return reply.send(data);
  });
};

export default feedbackPlugin;
