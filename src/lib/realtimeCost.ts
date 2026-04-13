import logger from "./logger.js";
import { calculateCost } from "./cost.js";

export interface RealTimeCostEntry {
  sessionId: string;
  userId: number;
  conversationId: string;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cost: number;
  timestamp: Date;
  requestType: string;
  cumulativeCost: number;
  cumulativeTokens: number;
}

export interface CostLedger {
  userId: number;
  currentSession: {
    sessionId: string;
    startTime: Date;
    totalCost: number;
    totalTokens: number;
    requestCount: number;
    requests: RealTimeCostEntry[];
  };
  dailyTotal: number;
  monthlyTotal: number;
  alerts: {
    dailyLimit: number;
    monthlyLimit: number;
    warnings: string[];
  };
}

class RealTimeCostTracker {
  private userLedgers: Map<number, CostLedger> = new Map();
  private sessionCosts: Map<string, RealTimeCostEntry[]> = new Map();
  private dailyLimits: Map<number, number> = new Map();
  private monthlyLimits: Map<number, number> = new Map();
  private alertCallbacks: Map<number, ((alerts: string[]) => void)[]> = new Map();
  
  private lastAccessTime: Map<number, Date> = new Map(); // userId -> last access
  private maxUsers = 10000; // Safety bound: max users to keep in memory
  private userTTLMs = 24 * 60 * 60 * 1000; // 24 hour TTL for user data
  private maxCallbacksPerUser = 10; // Safety bound: alert callbacks per user

  startSession(userId: number, sessionId: string, _conversationId: string): void {
    this.lastAccessTime.set(userId, new Date());
    
    this.enforceUserBounds();
    const ledger: CostLedger = {
      userId,
      currentSession: {
        sessionId,
        startTime: new Date(),
        totalCost: 0,
        totalTokens: 0,
        requestCount: 0,
        requests: []
      },
      dailyTotal: 0,
      monthlyTotal: 0,
      alerts: {
        dailyLimit: this.dailyLimits.get(userId) || 0,
        monthlyLimit: this.monthlyLimits.get(userId) || 0,
        warnings: []
      }
    };

    this.userLedgers.set(userId, ledger);
    this.sessionCosts.set(sessionId, []);

    logger.info({ userId, sessionId }, "Started real-time cost tracking");
  }

  private enforceUserBounds(): void {
    if (this.userLedgers.size < this.maxUsers) return;

    const userAccess = Array.from(this.lastAccessTime.entries());
    userAccess.sort((a, b) => a[1].getTime() - b[1].getTime());

    const usersToRemove = Math.ceil(this.maxUsers * 0.1);
    for (let i = 0; i < usersToRemove && i < userAccess.length; i++) {
      const userId = userAccess[i][0];
      this.removeUserData(userId);
    }

    logger.warn({ removed: usersToRemove, reason: "max_users_bound" }, "Cleaned up oldest user cost data");
  }

  private removeUserData(userId: number): void {
    this.userLedgers.delete(userId);
    this.dailyLimits.delete(userId);
    this.monthlyLimits.delete(userId);
    this.alertCallbacks.delete(userId);
    this.lastAccessTime.delete(userId);

    for (const [sessionId, entries] of this.sessionCosts.entries()) {
      if (entries[0]?.userId === userId) {
        this.sessionCosts.delete(sessionId);
      }
    }
  }

  addCostEntry(
    sessionId: string,
    userId: number,
    conversationId: string,
    provider: string,
    model: string,
    inputTokens: number,
    outputTokens: number,
    requestType: string = "deliberation"
  ): RealTimeCostEntry {
    this.lastAccessTime.set(userId, new Date());
    const cost = calculateCost(provider, model, inputTokens, outputTokens);
    
    const entry: RealTimeCostEntry = {
      sessionId,
      userId,
      conversationId,
      provider,
      model,
      inputTokens,
      outputTokens,
      cost,
      timestamp: new Date(),
      requestType,
      cumulativeCost: 0,
      cumulativeTokens: 0
    };

    const sessionEntries = this.sessionCosts.get(sessionId) || [];
    const previousTotal = sessionEntries.reduce((sum, e) => sum + e.cost, 0);
    const previousTokens = sessionEntries.reduce((sum, e) => sum + e.inputTokens + e.outputTokens, 0);
    
    entry.cumulativeCost = previousTotal + cost;
    entry.cumulativeTokens = previousTokens + inputTokens + outputTokens;
    
    sessionEntries.push(entry);
    this.sessionCosts.set(sessionId, sessionEntries);

    const ledger = this.userLedgers.get(userId);
    if (ledger) {
      ledger.currentSession.totalCost += cost;
      ledger.currentSession.totalTokens += inputTokens + outputTokens;
      ledger.currentSession.requestCount += 1;
      ledger.currentSession.requests.push(entry);
      
      this.checkLimits(userId);
    }

    logger.debug({
      sessionId,
      userId,
      cost,
      cumulative: entry.cumulativeCost
    }, "Added cost entry");

    return entry;
  }

  endSession(sessionId: string): RealTimeCostEntry[] {
    const entries = this.sessionCosts.get(sessionId) || [];
    const userId = entries[0]?.userId;
    
    if (userId) {
      const ledger = this.userLedgers.get(userId);
      if (ledger) {
        ledger.dailyTotal += ledger.currentSession.totalCost;
        ledger.monthlyTotal += ledger.currentSession.totalCost;
        
        logger.info({
          sessionId,
          userId,
          totalCost: ledger.currentSession.totalCost,
          totalTokens: ledger.currentSession.totalTokens,
          requestCount: ledger.currentSession.requestCount
        }, "Session ended - cost tracking complete");
      }
    }

    this.sessionCosts.delete(sessionId);
    
    logger.debug({ sessionId, userId }, "Session removed from tracking");
    
    return entries;
  }

  getLedger(userId: number): CostLedger | null {
    return this.userLedgers.get(userId) || null;
  }

  getRealTimeData(userId: number): {
    currentSession: {
      sessionId: string;
      totalCost: number;
      totalTokens: number;
      requestCount: number;
      recentRequests: RealTimeCostEntry[];
    };
    dailyTotal: number;
    monthlyTotal: number;
    alerts: string[];
  } | null {
    const ledger = this.userLedgers.get(userId);
    if (!ledger) return null;

    return {
      currentSession: {
        sessionId: ledger.currentSession.sessionId,
        totalCost: ledger.currentSession.totalCost,
        totalTokens: ledger.currentSession.totalTokens,
        requestCount: ledger.currentSession.requestCount,
        recentRequests: ledger.currentSession.requests.slice(-10) // Last 10 requests
      },
      dailyTotal: ledger.dailyTotal,
      monthlyTotal: ledger.monthlyTotal,
      alerts: ledger.alerts.warnings
    };
  }

  setLimits(userId: number, dailyLimit?: number, monthlyLimit?: number): void {
    if (dailyLimit !== undefined) {
      this.dailyLimits.set(userId, dailyLimit);
    }
    if (monthlyLimit !== undefined) {
      this.monthlyLimits.set(userId, monthlyLimit);
    }

    const ledger = this.userLedgers.get(userId);
    if (ledger) {
      ledger.alerts.dailyLimit = this.dailyLimits.get(userId) || 0;
      ledger.alerts.monthlyLimit = this.monthlyLimits.get(userId) || 0;
      this.checkLimits(userId);
    }
  }

  onAlert(userId: number, callback: (alerts: string[]) => void): void {
    const callbacks = this.alertCallbacks.get(userId) || [];
    
    if (callbacks.length >= this.maxCallbacksPerUser) {
      callbacks.shift(); // Remove oldest callback
      logger.warn({ userId, maxCallbacks: this.maxCallbacksPerUser }, "Alert callback bound reached, removed oldest");
    }
    
    callbacks.push(callback);
    this.alertCallbacks.set(userId, callbacks);
  }

  offAlert(userId: number, callback: (alerts: string[]) => void): void {
    const callbacks = this.alertCallbacks.get(userId) || [];
    const index = callbacks.indexOf(callback);
    if (index > -1) {
      callbacks.splice(index, 1);
      this.alertCallbacks.set(userId, callbacks);
    }
  }

  private checkLimits(userId: number): void {
    const ledger = this.userLedgers.get(userId);
    if (!ledger) return;

    const warnings: string[] = [];
    const { dailyLimit, monthlyLimit } = ledger.alerts;

    if (dailyLimit > 0) {
      const currentDailyTotal = ledger.dailyTotal + ledger.currentSession.totalCost;
      const dailyPercentage = (currentDailyTotal / dailyLimit) * 100;
      if (dailyPercentage >= 90) {
        warnings.push(`⚠️ Daily cost limit reached: ${currentDailyTotal.toFixed(2)} / ${dailyLimit.toFixed(2)}`);
      } else if (dailyPercentage >= 80) {
        warnings.push(`⚠️ Approaching daily cost limit: ${currentDailyTotal.toFixed(2)} / ${dailyLimit.toFixed(2)}`);
      }
    }

    if (monthlyLimit > 0) {
      const currentMonthlyTotal = ledger.monthlyTotal + ledger.currentSession.totalCost;
      const monthlyPercentage = (currentMonthlyTotal / monthlyLimit) * 100;
      if (monthlyPercentage >= 90) {
        warnings.push(`🚨 Monthly cost limit reached: ${currentMonthlyTotal.toFixed(2)} / ${monthlyLimit.toFixed(2)}`);
      } else if (monthlyPercentage >= 80) {
        warnings.push(`⚠️ Approaching monthly cost limit: ${currentMonthlyTotal.toFixed(2)} / ${monthlyLimit.toFixed(2)}`);
      }
    }

    if (ledger.currentSession.totalCost > 10) {
      warnings.push(`💰 High session cost: ${ledger.currentSession.totalCost.toFixed(2)}`);
    }

    if (warnings.length > 0) {
      ledger.alerts.warnings = warnings;
      const callbacks = this.alertCallbacks.get(userId) || [];
      callbacks.forEach(callback => callback(warnings));
    } else {
      ledger.alerts.warnings = [];
    }
  }

  getStatistics(userId: number, hours: number = 24): {
    totalCost: number;
    totalTokens: number;
    requestCount: number;
    averageCostPerRequest: number;
    topProviders: Array<{ provider: string; cost: number; requests: number }>;
    costTrend: Array<{ timestamp: Date; cost: number }>;
  } | null {
    const ledger = this.userLedgers.get(userId);
    if (!ledger) return null;

    const cutoffTime = new Date(Date.now() - hours * 60 * 60 * 1000);
    const recentEntries = ledger.currentSession.requests.filter(entry => entry.timestamp >= cutoffTime);

    const totalCost = recentEntries.reduce((sum, entry) => sum + entry.cost, 0);
    const totalTokens = recentEntries.reduce((sum, entry) => sum + entry.inputTokens + entry.outputTokens, 0);
    const requestCount = recentEntries.length;

    const providerStats = new Map<string, { cost: number; requests: number }>();
    recentEntries.forEach(entry => {
      const stats = providerStats.get(entry.provider) || { cost: 0, requests: 0 };
      stats.cost += entry.cost;
      stats.requests += 1;
      providerStats.set(entry.provider, stats);
    });

    const topProviders = Array.from(providerStats.entries())
      .map(([provider, stats]) => ({ provider, ...stats }))
      .sort((a, b) => b.cost - a.cost)
      .slice(0, 5);

    const costTrend = new Map<number, number>();
    recentEntries.forEach(entry => {
      const hour = Math.floor(entry.timestamp.getTime() / (60 * 60 * 1000)) * (60 * 60 * 1000);
      const current = costTrend.get(hour) || 0;
      costTrend.set(hour, current + entry.cost);
    });

    const trend = Array.from(costTrend.entries())
      .map(([timestamp, cost]) => ({ timestamp: new Date(timestamp), cost }))
      .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

    return {
      totalCost,
      totalTokens,
      requestCount,
      averageCostPerRequest: requestCount > 0 ? totalCost / requestCount : 0,
      topProviders,
      costTrend: trend
    };
  }

  cleanup(): void {
    const cutoffTime = new Date(Date.now() - this.userTTLMs);
    let cleanedSessions = 0;
    let cleanedUsers = 0;
    
    for (const [sessionId, entries] of this.sessionCosts.entries()) {
      const lastEntry = entries[entries.length - 1];
      if (lastEntry && lastEntry.timestamp < cutoffTime) {
        this.sessionCosts.delete(sessionId);
        cleanedSessions++;
      }
    }

    for (const [userId, lastAccess] of this.lastAccessTime.entries()) {
      if (lastAccess < cutoffTime) {
        this.removeUserData(userId);
        cleanedUsers++;
      }
    }

    logger.info({ 
      cleanedSessions, 
      cleanedUsers, 
      activeSessions: this.sessionCosts.size,
      activeUsers: this.userLedgers.size 
    }, "Cost tracking cleanup complete");
  }
}

export const realTimeCostTracker = new RealTimeCostTracker();

const costTrackerInterval = setInterval(() => {
  realTimeCostTracker.cleanup();
}, 60 * 60 * 1000);

export function cleanupCostTrackerInterval(): void {
  clearInterval(costTrackerInterval);
}
