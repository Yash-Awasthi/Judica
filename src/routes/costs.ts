import { Router, Response, NextFunction } from "express";
import { requireAuth } from "../middleware/auth.js";
import { AuthRequest } from "../types/index.js";
import prisma from "../lib/db.js";
import { 
  getUserCostBreakdown, 
  getOrganizationCostSummary, 
  checkUserCostLimits,
  getCostEfficiencyMetrics,
  DEFAULT_COST_CONFIG
} from "../lib/cost.js";
import { AppError } from "../middleware/errorHandler.js";

const router = Router();

router.get("/breakdown", requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { days = 30 } = req.query;
    const breakdown = await getUserCostBreakdown(req.userId!, parseInt(days as string));
    
    res.json({
      breakdown,
      period: `${days} days`,
      currency: "USD"
    });
  } catch (err) {
    next(err);
  }
});

router.get("/limits", requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { dailyLimit, monthlyLimit } = req.query;
    
    const limits = await checkUserCostLimits(
      req.userId!,
      dailyLimit ? parseFloat(dailyLimit as string) : undefined,
      monthlyLimit ? parseFloat(monthlyLimit as string) : undefined
    );
    
    res.json(limits);
  } catch (err) {
    next(err);
  }
});

router.get("/efficiency", requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { days = 30 } = req.query;
    const metrics = await getCostEfficiencyMetrics(req.userId!, parseInt(days as string));
    
    res.json(metrics);
  } catch (err) {
    next(err);
  }
});

router.get("/pricing", requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    res.json({
      pricing: DEFAULT_COST_CONFIG,
      currency: "USD",
      lastUpdated: new Date().toISOString()
    });
  } catch (err) {
    next(err);
  }
});

router.get("/organization", requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.userId! },
      select: { role: true }
    });
    
    if (!user || user.role !== 'admin') {
      throw new AppError(403, "Admin access required");
    }
    
    const { days = 30 } = req.query;
    const summary = await getOrganizationCostSummary(parseInt(days as string));
    
    res.json({
      summary,
      period: `${days} days`,
      currency: "USD"
    });
  } catch (err) {
    next(err);
  }
});

router.get("/dashboard", requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { days = 30 } = req.query;
    const daysNum = parseInt(days as string);
    
    const [breakdown, efficiency, limits] = await Promise.all([
      getUserCostBreakdown(req.userId!, daysNum),
      getCostEfficiencyMetrics(req.userId!, daysNum),
      checkUserCostLimits(req.userId!)
    ]);
    
    res.json({
      currentPeriod: {
        totalCost: breakdown.totalCost,
        totalTokens: breakdown.totalTokens,
        avgCostPerRequest: breakdown.totalCost / Object.values(breakdown.byTimeframe).reduce((sum, day) => sum + day.requests, 0) || 0
      },
      efficiency,
      limits,
      trends: breakdown.byTimeframe,
      topProviders: Object.entries(breakdown.byProvider)
        .sort(([,a], [,b]) => b.cost - a.cost)
        .slice(0, 5)
        .map(([provider, data]) => ({ provider, ...data })),
      currency: "USD"
    });
  } catch (err) {
    next(err);
  }
});

export default router;
