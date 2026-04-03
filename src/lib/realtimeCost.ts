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
  // IN-Memory Storage - All Maps have TTL-based cleanup via cleanup() method
  private userLedgers: Map<number, CostLedger> = new Map();
  private sessionCosts: Map<string, RealTimeCostEntry[]> = new Map();
  private dailyLimits: Map<number, number> = new Map();
  private monthlyLimits: Map<number, number> = new Map();
  private alertCallbacks: Map<number, ((alerts: string[]) => void)[]> = new Map();
  
  // Metadata for TTL tracking
  private lastAccessTime: Map<number, Date> = new Map(); // userId -> last access
  private maxUsers = 10000; // Safety bound: max users to keep in memory
  private userTTLMs = 24 * 60 * 60 * 1000; // 24 hour TTL for user data
  private maxCallbacksPerUser = 10; // Safety bound: alert callbacks per user

  /**
   * Start tracking a new session.
   * Lifecycle: Creates ledger and session entry. Both cleaned up via cleanup() after TTL.
   */
  startSession(userId: number, sessionId: string, _conversationId: string): void {
    // Update access time for TTL tracking
    this.lastAccessTime.set(userId, new Date());
    
    // Check bounds before adding new user
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

  /**
   * Enforce max user bounds by removing oldest accessed users.
   * Called automatically when adding new users.
   */
  private enforceUserBounds(): void {
    if (this.userLedgers.size < this.maxUsers) return;

    // Find users with oldest last access time
    const userAccess = Array.from(this.lastAccessTime.entries());
    userAccess.sort((a, b) => a[1].getTime() - b[1].getTime());

    // Remove oldest 10% of users to make room
    const usersToRemove = Math.ceil(this.maxUsers * 0.1);
    for (let i = 0; i < usersToRemove && i < userAccess.length; i++) {
      const userId = userAccess[i][0];
      this.removeUserData(userId);
    }

    logger.warn({ removed: usersToRemove, reason: "max_users_bound" }, "Cleaned up oldest user cost data");
  }

  /**
   * Remove all data for a specific user.
   * Used for cleanup and bound enforcement.
   */
  private removeUserData(userId: number): void {
    this.userLedgers.delete(userId);
    this.dailyLimits.delete(userId);
    this.monthlyLimits.delete(userId);
    this.alertCallbacks.delete(userId);
    this.lastAccessTime.delete(userId);

    // Also clean up any orphaned sessions for this user
    for (const [sessionId, entries] of this.sessionCosts.entries()) {
      if (entries[0]?.userId === userId) {
        this.sessionCosts.delete(sessionId);
      }
    }
  }

  /**
   * Add a cost entry to the current session.
   * Updates lastAccessTime to extend TTL for active users.
   */
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
    // Update access time for TTL tracking
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

    // Update session costs
    const sessionEntries = this.sessionCosts.get(sessionId) || [];
    const previousTotal = sessionEntries.reduce((sum, e) => sum + e.cost, 0);
    const previousTokens = sessionEntries.reduce((sum, e) => sum + e.inputTokens + e.outputTokens, 0);
    
    entry.cumulativeCost = previousTotal + cost;
    entry.cumulativeTokens = previousTokens + inputTokens + outputTokens;
    
    sessionEntries.push(entry);
    this.sessionCosts.set(sessionId, sessionEntries);

    // Update user ledger
    const ledger = this.userLedgers.get(userId);
    if (ledger) {
      ledger.currentSession.totalCost += cost;
      ledger.currentSession.totalTokens += inputTokens + outputTokens;
      ledger.currentSession.requestCount += 1;
      ledger.currentSession.requests.push(entry);
      
      // Check limits and generate alerts
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

  /**
   * End a session and calculate final costs.
   * Also cleans up user data if this was their last active session.
   */
  endSession(sessionId: string): RealTimeCostEntry[] {
    const entries = this.sessionCosts.get(sessionId) || [];
    const userId = entries[0]?.userId;
    
    if (userId) {
      const ledger = this.userLedgers.get(userId);
      if (ledger) {
        // Update daily and monthly totals
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

    // Clean up session data
    this.sessionCosts.delete(sessionId);
    
    // If user has no more active sessions, mark for TTL cleanup
    // (Actual cleanup happens in cleanup() based on lastAccessTime)
    logger.debug({ sessionId, userId }, "Session removed from tracking");
    
    return entries;
  }

  /**
   * Get current ledger for a user.
   */
  getLedger(userId: number): CostLedger | null {
    return this.userLedgers.get(userId) || null;
  }

  /**
   * Get real-time cost data for WebSocket streaming.
   */
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

  /**
   * Set cost limits for a user.
   */
  setLimits(userId: number, dailyLimit?: number, monthlyLimit?: number): void {
    if (dailyLimit !== undefined) {
      this.dailyLimits.set(userId, dailyLimit);
    }
    if (monthlyLimit !== undefined) {
      this.monthlyLimits.set(userId, monthlyLimit);
    }

    // Update existing ledger if present
    const ledger = this.userLedgers.get(userId);
    if (ledger) {
      ledger.alerts.dailyLimit = this.dailyLimits.get(userId) || 0;
      ledger.alerts.monthlyLimit = this.monthlyLimits.get(userId) || 0;
      this.checkLimits(userId);
    }
  }

  /**
   * Register alert callback for real-time notifications.
   * Enforces maxCallbacksPerUser bound to prevent memory leaks.
   */
  onAlert(userId: number, callback: (alerts: string[]) => void): void {
    const callbacks = this.alertCallbacks.get(userId) || [];
    
    // Enforce callback bound - remove oldest if at limit
    if (callbacks.length >= this.maxCallbacksPerUser) {
      callbacks.shift(); // Remove oldest callback
      logger.warn({ userId, maxCallbacks: this.maxCallbacksPerUser }, "Alert callback bound reached, removed oldest");
    }
    
    callbacks.push(callback);
    this.alertCallbacks.set(userId, callbacks);
  }

  /**
   * Remove alert callback.
   */
  offAlert(userId: number, callback: (alerts: string[]) => void): void {
    const callbacks = this.alertCallbacks.get(userId) || [];
    const index = callbacks.indexOf(callback);
    if (index > -1) {
      callbacks.splice(index, 1);
      this.alertCallbacks.set(userId, callbacks);
    }
  }

  /**
   * Check if user is approaching limits and generate alerts.
   */
  private checkLimits(userId: number): void {
    const ledger = this.userLedgers.get(userId);
    if (!ledger) return;

    const warnings: string[] = [];
    const { dailyLimit, monthlyLimit } = ledger.alerts;

    // Check daily limit
    if (dailyLimit > 0) {
      const dailyPercentage = (ledger.dailyTotal / dailyLimit) * 100;
      if (dailyPercentage >= 90) {
        warnings.push(`⚠️ Daily cost limit reached: ${ledger.dailyTotal.toFixed(2)} / ${dailyLimit.toFixed(2)}`);
      } else if (dailyPercentage >= 80) {
        warnings.push(`⚠️ Approaching daily cost limit: ${ledger.dailyTotal.toFixed(2)} / ${dailyLimit.toFixed(2)}`);
      }
    }

    // Check monthly limit
    if (monthlyLimit > 0) {
      const monthlyPercentage = (ledger.monthlyTotal / monthlyLimit) * 100;
      if (monthlyPercentage >= 90) {
        warnings.push(`🚨 Monthly cost limit reached: ${ledger.monthlyTotal.toFixed(2)} / ${monthlyLimit.toFixed(2)}`);
      } else if (monthlyPercentage >= 80) {
        warnings.push(`⚠️ Approaching monthly cost limit: ${ledger.monthlyTotal.toFixed(2)} / ${monthlyLimit.toFixed(2)}`);
      }
    }

    // Check session cost
    if (ledger.currentSession.totalCost > 10) {
      warnings.push(`💰 High session cost: ${ledger.currentSession.totalCost.toFixed(2)}`);
    }

    // Update alerts and notify callbacks
    if (warnings.length > 0) {
      ledger.alerts.warnings = warnings;
      const callbacks = this.alertCallbacks.get(userId) || [];
      callbacks.forEach(callback => callback(warnings));
    } else {
      ledger.alerts.warnings = [];
    }
  }

  /**
   * Get cost statistics for analytics.
   */
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

    // Provider breakdown
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

    // Cost trend (group by hour)
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

  /**
   * Clean up old data based on TTL.
   * Called automatically every hour via setInterval.
   * Removes:
   * - Sessions older than 24h
   * - User data (ledgers, limits, callbacks) not accessed in 24h
   */
  cleanup(): void {
    const cutoffTime = new Date(Date.now() - this.userTTLMs);
    let cleanedSessions = 0;
    let cleanedUsers = 0;
    
    // Clean up old sessions
    for (const [sessionId, entries] of this.sessionCosts.entries()) {
      const lastEntry = entries[entries.length - 1];
      if (lastEntry && lastEntry.timestamp < cutoffTime) {
        this.sessionCosts.delete(sessionId);
        cleanedSessions++;
      }
    }

    // Clean up user data based on last access time
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

// Global instance
export const realTimeCostTracker = new RealTimeCostTracker();

// Cleanup old data every hour
setInterval(() => {
  realTimeCostTracker.cleanup();
}, 60 * 60 * 1000);
