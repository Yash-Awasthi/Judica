import { Router, Response, NextFunction } from "express";
import { requireAuth } from "../middleware/auth.js";
import { AuthRequest } from "../types/index.js";
import { 
  evaluateCouncilSession,
  getUserEvaluationMetrics,
  benchmarkCouncilPerformance
} from "../lib/evaluation.js";
import { AppError } from "../middleware/errorHandler.js";

const router = Router();

// ── POST /api/evaluation/session - Evaluate a council session ───────────────────────
router.post("/session", requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { 
      sessionId, 
      conversationId, 
      agentOutputs, 
      totalTokens, 
      duration, 
      userFeedback 
    } = req.body;
    
    if (!sessionId || !conversationId || !agentOutputs || !totalTokens || !duration) {
      throw new AppError(400, "Missing required fields: sessionId, conversationId, agentOutputs, totalTokens, duration");
    }
    
    const result = await evaluateCouncilSession(
      sessionId,
      conversationId,
      req.userId!,
      agentOutputs,
      totalTokens,
      duration,
      userFeedback
    );
    
    res.json({
      success: true,
      evaluation: result
    });
  } catch (err) {
    next(err);
  }
});

// ── GET /api/evaluation/metrics - Get user evaluation metrics ────────────────────────
router.get("/metrics", requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { days = 30 } = req.query;
    const metrics = await getUserEvaluationMetrics(req.userId!, parseInt(days as string));
    
    res.json({
      metrics,
      period: `${days} days`
    });
  } catch (err) {
    next(err);
  }
});

// ── GET /api/evaluation/benchmark - Get performance benchmark ───────────────────────
router.get("/benchmark", requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { councilSize = 3, queryComplexity = 'moderate' } = req.query;
    
    const benchmark = await benchmarkCouncilPerformance(
      req.userId!,
      parseInt(councilSize as string),
      queryComplexity as 'simple' | 'moderate' | 'complex'
    );
    
    res.json({
      benchmark,
      councilSize,
      queryComplexity
    });
  } catch (err) {
    next(err);
  }
});

// ── GET /api/evaluation/dashboard - Get evaluation dashboard data ─────────────────────
router.get("/dashboard", requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { days = 30 } = req.query;
    const daysNum = parseInt(days as string);
    
    const [metrics, benchmark] = await Promise.all([
      getUserEvaluationMetrics(req.userId!, daysNum),
      benchmarkCouncilPerformance(req.userId!, 3, 'moderate')
    ]);
    
    res.json({
      currentPerformance: {
        overallScore: metrics.averageConsensus * 25 + metrics.averageQuality * 25 + metrics.averageDiversity * 25 + metrics.averageEfficiency * 25,
        consensus: metrics.averageConsensus,
        quality: metrics.averageQuality,
        diversity: metrics.averageDiversity,
        efficiency: metrics.averageEfficiency,
        trend: metrics.improvementTrend
      },
      benchmark,
      totalEvaluations: metrics.totalEvaluations,
      period: `${days} days`
    });
  } catch (err) {
    next(err);
  }
});

export default router;
