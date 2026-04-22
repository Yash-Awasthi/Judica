import type { FastifyPluginAsync } from "fastify";
import { fastifyRequireAuth } from "../middleware/fastifyAuth.js";
import { realTimeCostTracker } from "../lib/realtimeCost.js";
import { env } from "../config/env.js";
import { WebSocketServer, WebSocket } from "ws";
import logger from "../lib/logger.js";
import { AppError } from "../middleware/errorHandler.js";
import jwt from "jsonwebtoken";

interface CostSocket extends WebSocket {
  userId?: number;
}

const realtimePlugin: FastifyPluginAsync = async (fastify) => {
  const wss = new WebSocketServer({ server: fastify.server });

  wss.on('connection', (ws: CostSocket) => {
    logger.info("User connected to real-time cost tracking");

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString());

        if (msg.type === 'authenticate') {
          // Verify JWT token instead of trusting client-provided userId
          if (!msg.token) {
            ws.send(JSON.stringify({ event: 'error', data: { message: 'Authentication token required' } }));
            return;
          }
          try {
            const payload = jwt.verify(msg.token, env.JWT_SECRET, { algorithms: ['HS256'] }) as { userId?: number; username?: string; id?: number; sub?: number };
            const userId = payload.userId || payload.id || payload.sub;
            if (!userId) {
              ws.send(JSON.stringify({ event: 'error', data: { message: 'Invalid token: no userId' } }));
              return;
            }
            ws.userId = userId;

            const costData = realTimeCostTracker.getRealTimeData(userId);
            if (costData) {
              ws.send(JSON.stringify({ event: 'cost-update', data: costData }));
            }

            realTimeCostTracker.onAlert(userId, (alerts) => {
              if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ event: 'cost-alert', data: { alerts, timestamp: new Date() } }));
              }
            });

            logger.info({ userId }, "User authenticated for real-time updates");
          } catch {
            ws.send(JSON.stringify({ event: 'error', data: { message: 'Invalid or expired token' } }));
          }
        } else if (msg.type === 'request-cost-data' && ws.userId) {
          const costData = realTimeCostTracker.getRealTimeData(ws.userId);
          if (costData) {
            ws.send(JSON.stringify({ event: 'cost-update', data: costData }));
          }
        } else if (msg.type === 'set-limits' && ws.userId) {
          // P5-04: Validate limit values to prevent abuse
          const dailyLimit = typeof msg.dailyLimit === 'number' && msg.dailyLimit > 0 && msg.dailyLimit <= 10_000 ? msg.dailyLimit : undefined;
          const monthlyLimit = typeof msg.monthlyLimit === 'number' && msg.monthlyLimit > 0 && msg.monthlyLimit <= 100_000 ? msg.monthlyLimit : undefined;
          if (dailyLimit !== undefined || monthlyLimit !== undefined) {
            realTimeCostTracker.setLimits(ws.userId, dailyLimit, monthlyLimit);
          }
        } else if (msg.type === 'get-statistics' && ws.userId) {
          // P5-05: Validate hours param
          const hours = typeof msg.hours === 'number' && msg.hours > 0 && msg.hours <= 8760 ? msg.hours : 24;
          const stats = realTimeCostTracker.getStatistics(ws.userId, hours);
          ws.send(JSON.stringify({ event: 'statistics-update', data: stats }));
        }
      } catch {
        // Ignore invalid messages
      }
    });

    ws.on('close', () => {
      if (ws.userId) {
        logger.info({ userId: ws.userId }, "User disconnected from real-time updates");
      }
    });
  });
  fastify.post("/session/start", { preHandler: fastifyRequireAuth }, async (request, reply) => {
    try {
      const { sessionId, conversationId } = request.body as { sessionId?: string; conversationId?: string };

      if (!sessionId || !conversationId) {
        return reply.code(400).send({ error: "sessionId and conversationId are required" });
      }

      realTimeCostTracker.startSession(request.userId!, sessionId, conversationId);

      return {
        success: true,
        sessionId,
        message: "Cost tracking started"
      };
    } catch (err) {
      throw new AppError(500, (err as Error).message, "COST_SESSION_START_FAILED");
    }
  });

  fastify.post("/session/end", { preHandler: fastifyRequireAuth }, async (request, reply) => {
    try {
      const { sessionId } = request.body as { sessionId?: string };

      if (!sessionId) {
        return reply.code(400).send({ error: "sessionId is required" });
      }

      const entries = realTimeCostTracker.endSession(sessionId);

      return {
        success: true,
        sessionId,
        totalCost: entries.reduce((sum, entry) => sum + entry.cost, 0),
        totalTokens: entries.reduce((sum, entry) => sum + entry.inputTokens + entry.outputTokens, 0),
        requestCount: entries.length
      };
    } catch (err) {
      throw new AppError(500, (err as Error).message, "COST_SESSION_END_FAILED");
    }
  });

  fastify.get("/ledger", { preHandler: fastifyRequireAuth }, async (request, reply) => {
    try {
      const ledger = realTimeCostTracker.getLedger(request.userId!);

      if (!ledger) {
        return reply.code(404).send({ error: "No active cost tracking session" });
      }

      return {
        success: true,
        ledger
      };
    } catch (err) {
      throw new AppError(500, (err as Error).message, "COST_LEDGER_FETCH_FAILED");
    }
  });

    fastify.get("/statistics", { preHandler: fastifyRequireAuth }, async (request, _reply) => {
    try {
      const { hours = "24" } = request.query as { hours?: string };

      // P5-05: Validate and clamp hours parameter
      const parsedHours = Math.min(Math.max(parseInt(hours as string, 10) || 24, 1), 8760);
      const stats = realTimeCostTracker.getStatistics(request.userId!, parsedHours);

      return {
        success: true,
        statistics: stats
      };
    } catch (err) {
      throw new AppError(500, (err as Error).message, "COST_STATISTICS_FETCH_FAILED");
    }
  });
};

export default realtimePlugin;
