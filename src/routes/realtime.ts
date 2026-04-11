import { Router, Response } from "express";
import { requireAuth } from "../middleware/auth.js";
import { AuthRequest } from "../types/index.js";
import { realTimeCostTracker } from "../lib/realtimeCost.js";
import { env } from "../config/env.js";
import { createServer } from "http";
import { Server as SocketIOServer, Socket } from "socket.io";
import logger from "../lib/logger.js";
import { AppError } from "../middleware/errorHandler.js";

interface SocketWithUserId extends Socket {
  userId?: number;
}

const router = Router();

const httpServer = createServer();
const io = new SocketIOServer(httpServer, {
  cors: {
    origin: env.FRONTEND_URL || "http://localhost:3000",
    methods: ["GET", "POST"]
  }
});

const connectedUsers = new Map<number, string>();

io.on('connection', (socket) => {
  logger.info("User connected to real-time cost tracking");

  const socketWithId = socket as SocketWithUserId;

  socket.on('authenticate', (data: { userId: number, token: string }) => {
    connectedUsers.set(data.userId, socket.id);
    socketWithId.userId = data.userId;
    
    const costData = realTimeCostTracker.getRealTimeData(data.userId);
    if (costData) {
      socket.emit('cost-update', costData);
    }

    realTimeCostTracker.onAlert(data.userId, (alerts) => {
      socket.emit('cost-alert', { alerts, timestamp: new Date() });
    });

    logger.info({ userId: data.userId }, "User authenticated for real-time updates");
  });

  socket.on('disconnect', () => {
    if (socketWithId.userId) {
      connectedUsers.delete(socketWithId.userId);
      logger.info({ userId: socketWithId.userId }, "User disconnected from real-time updates");
    }
  });

  socket.on('request-cost-data', (userId: number) => {
    const costData = realTimeCostTracker.getRealTimeData(userId);
    if (costData) {
      socket.emit('cost-update', costData);
    }
  });

  socket.on('set-limits', (data: { userId: number; dailyLimit?: number; monthlyLimit?: number }) => {
    realTimeCostTracker.setLimits(data.userId, data.dailyLimit, data.monthlyLimit);
  });

  socket.on('get-statistics', (data: { userId: number; hours?: number }) => {
    const stats = realTimeCostTracker.getStatistics(data.userId, data.hours);
    socket.emit('statistics-update', stats);
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

export { io, httpServer };

export default router;
