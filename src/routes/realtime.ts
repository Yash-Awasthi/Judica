import { Router, Response } from "express";
import { requireAuth } from "../middleware/auth.js";
import { AuthRequest } from "../types/index.js";
import { realTimeCostTracker } from "../lib/realtimeCost.js";
import { env } from "../config/env.js";
import { WebSocketServer, WebSocket } from "ws";
import { createServer } from "http";
import logger from "../lib/logger.js";
import { AppError } from "../middleware/errorHandler.js";

interface CostSocket extends WebSocket {
  userId?: number;
}

const router = Router();

const httpServer = createServer();
const wss = new WebSocketServer({ server: httpServer });

const connectedUsers = new Map<number, string>();

wss.on('connection', (ws: CostSocket) => {
  logger.info("User connected to real-time cost tracking");

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString());

      if (msg.type === 'authenticate') {
        connectedUsers.set(msg.userId, '');
        ws.userId = msg.userId;

        const costData = realTimeCostTracker.getRealTimeData(msg.userId);
        if (costData) {
          ws.send(JSON.stringify({ event: 'cost-update', data: costData }));
        }

        realTimeCostTracker.onAlert(msg.userId, (alerts) => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ event: 'cost-alert', data: { alerts, timestamp: new Date() } }));
          }
        });

        logger.info({ userId: msg.userId }, "User authenticated for real-time updates");
      } else if (msg.type === 'request-cost-data' && msg.userId) {
        const costData = realTimeCostTracker.getRealTimeData(msg.userId);
        if (costData) {
          ws.send(JSON.stringify({ event: 'cost-update', data: costData }));
        }
      } else if (msg.type === 'set-limits') {
        realTimeCostTracker.setLimits(msg.userId, msg.dailyLimit, msg.monthlyLimit);
      } else if (msg.type === 'get-statistics') {
        const stats = realTimeCostTracker.getStatistics(msg.userId, msg.hours);
        ws.send(JSON.stringify({ event: 'statistics-update', data: stats }));
      }
    } catch {
      // Ignore invalid messages
    }
  });

  ws.on('close', () => {
    if (ws.userId) {
      connectedUsers.delete(ws.userId);
      logger.info({ userId: ws.userId }, "User disconnected from real-time updates");
    }
  });
});

router.post("/session/start", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { sessionId, conversationId } = req.body;

    if (!sessionId || !conversationId) {
      return res.status(400).json({ error: "sessionId and conversationId are required" });
    }

    realTimeCostTracker.startSession(req.userId!, sessionId, conversationId);

    res.json({
      success: true,
      sessionId,
      message: "Cost tracking started"
    });
  } catch (err) {
    throw new AppError(500, (err as Error).message, "COST_SESSION_START_FAILED");
  }
});

router.post("/session/end", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { sessionId } = req.body;

    if (!sessionId) {
      return res.status(400).json({ error: "sessionId is required" });
    }

    const entries = realTimeCostTracker.endSession(sessionId);

    res.json({
      success: true,
      sessionId,
      totalCost: entries.reduce((sum, entry) => sum + entry.cost, 0),
      totalTokens: entries.reduce((sum, entry) => sum + entry.inputTokens + entry.outputTokens, 0),
      requestCount: entries.length
    });
  } catch (err) {
    throw new AppError(500, (err as Error).message, "COST_SESSION_END_FAILED");
  }
});

router.get("/ledger", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const ledger = realTimeCostTracker.getLedger(req.userId!);

    if (!ledger) {
      return res.status(404).json({ error: "No active cost tracking session" });
    }

    res.json({
      success: true,
      ledger
    });
  } catch (err) {
    throw new AppError(500, (err as Error).message, "COST_LEDGER_FETCH_FAILED");
  }
});

router.get("/statistics", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { hours = 24 } = req.query;

    const stats = realTimeCostTracker.getStatistics(req.userId!, parseInt(hours as string));

    res.json({
      success: true,
      statistics: stats
    });
  } catch (err) {
    throw new AppError(500, (err as Error).message, "COST_STATISTICS_FETCH_FAILED");
  }
});

export { wss, httpServer };

export default router;
