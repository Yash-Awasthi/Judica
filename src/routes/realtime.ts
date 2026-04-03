import { Router, Response } from "express";
import { requireAuth } from "../middleware/auth.js";
import { AuthRequest } from "../types/index.js";
import { realTimeCostTracker } from "../lib/realtimeCost.js";
import { createServer } from "http";
import { Server as SocketIOServer, Socket } from "socket.io";
import logger from "../lib/logger.js";

// Extend Socket type to include userId
interface SocketWithUserId extends Socket {
  userId?: number;
}

const router = Router();

// Create Socket.IO server for real-time updates
const httpServer = createServer();
const io = new SocketIOServer(httpServer, {
  cors: {
    origin: process.env.FRONTEND_URL || "http://localhost:3000",
    methods: ["GET", "POST"]
  }
});

// Store connected users
const connectedUsers = new Map<number, string>();

// WebSocket connection handling
io.on('connection', (socket) => {
  logger.info("User connected to real-time cost tracking");

  const socketWithId = socket as SocketWithUserId;

  socket.on('authenticate', (data: { userId: number, token: string }) => {
    // Here you would validate the token
    // For now, we'll assume it's valid
    connectedUsers.set(data.userId, socket.id);
    socketWithId.userId = data.userId;
    
    // Send current cost data
    const costData = realTimeCostTracker.getRealTimeData(data.userId);
    if (costData) {
      socket.emit('cost-update', costData);
    }

    // Register for alerts
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

// ── POST /api/realtime/session/start - Start cost tracking session ─────────────────────
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
    res.status(500).json({ error: (err as Error).message });
  }
});

// ── POST /api/realtime/session/end - End cost tracking session ───────────────────────
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
    res.status(500).json({ error: (err as Error).message });
  }
});

// ── GET /api/realtime/ledger - Get current cost ledger ───────────────────────────────
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
    res.status(500).json({ error: (err as Error).message });
  }
});

// ── GET /api/realtime/statistics - Get cost statistics ───────────────────────────────
router.get("/statistics", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { hours = 24 } = req.query;
    
    const stats = realTimeCostTracker.getStatistics(req.userId!, parseInt(hours as string));
    
    res.json({
      success: true,
      statistics: stats
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// Export the Socket.IO server for use in the main app
export { io, httpServer };

export default router;
