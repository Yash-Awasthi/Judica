import { db } from "./drizzle.js";
import { lt } from "drizzle-orm";
import { semanticCache, auditLogs, contextSummaries } from "../db/schema/conversations.js";
import { revokedTokens } from "../db/schema/auth.js";
import redis from "./redis.js";
import logger from "./logger.js";

const SWEEP_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
const TOKEN_TTL_DAYS = 90; // 90 days

let sweepTimer: NodeJS.Timeout | null = null;

async function sweepCache(): Promise<number> {
  try {
    const result = await db
      .delete(semanticCache)
      .where(lt(semanticCache.expiresAt, new Date()));
    const count = result.rowCount ?? 0;
    if (count > 0) {
      logger.info({ count }, "Swept expired cache entries");
    }
    return count;
  } catch (err) {
    logger.error({ err: (err as Error).message }, "Failed to sweep cache");
    return 0;
  }
}

async function sweepRevokedTokens(): Promise<number> {
  try {
    const result = await db
      .delete(revokedTokens)
      .where(lt(revokedTokens.expiresAt, new Date()));
    const count = result.rowCount ?? 0;
    if (count > 0) {
      logger.info({ count }, "Swept expired revoked tokens");
    }
    return count;
  } catch (err) {
    logger.error({ err: (err as Error).message }, "Failed to sweep revoked tokens");
    return 0;
  }
}

async function sweepAuditLogs(): Promise<number> {
  try {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - TOKEN_TTL_DAYS);

    const result = await db
      .delete(auditLogs)
      .where(lt(auditLogs.createdAt, cutoff));
    const count = result.rowCount ?? 0;
    if (count > 0) {
      logger.info({ count }, "Swept old audit logs");
    }
    return count;
  } catch (err) {
    logger.error({ err: (err as Error).message }, "Failed to sweep audit logs");
    return 0;
  }
}

async function sweepContextSummaries(): Promise<number> {
  try {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 30);

    const result = await db
      .delete(contextSummaries)
      .where(lt(contextSummaries.createdAt, cutoff));
    const count = result.rowCount ?? 0;
    if (count > 0) {
      logger.info({ count }, "Swept old context summaries");
    }
    return count;
  } catch (err) {
    logger.error({ err: (err as Error).message }, "Failed to sweep context summaries");
    return 0;
  }
}

async function sweepRedisKeys(): Promise<number> {
  try {
    const keys = await redis.keys("cache:*");
    let swept = 0;

    for (const key of keys) {
      const ttl = await redis.pttl(key);
      // TTL -1 = no expiration (persistent key, do NOT delete)
      // TTL -2 = key doesn't exist (skip)
      // TTL  0 = actively expiring
      if (ttl === -2 || ttl === -1) {
        continue;
      }
      if (ttl === 0) {
        await redis.del(key);
        swept++;
      }
    }

    if (swept > 0) {
      logger.info({ count: swept }, "Swept Redis keys");
    }
    return swept;
  } catch (err) {
    logger.error({ err: (err as Error).message }, "Failed to sweep Redis keys");
    return 0;
  }
}

async function runSweep(): Promise<void> {
  logger.info("Starting sweep job");

  const startTime = Date.now();
  const results = await Promise.allSettled([
    sweepCache(),
    sweepRevokedTokens(),
    sweepAuditLogs(),
    sweepContextSummaries(),
    sweepRedisKeys(),
  ]);

  const totalSwept = results.reduce((sum, result) => {
    if (result.status === "fulfilled") {
      return sum + result.value;
    }
    return sum;
  }, 0);

  const duration = Date.now() - startTime;
  logger.info({ totalSwept, duration }, "Sweep job completed");
}

export function startSweepers(): void {
  if (sweepTimer) {
    logger.warn("Sweepers already running");
    return;
  }

  void runSweep();

  sweepTimer = setInterval(() => {
    void runSweep();
  }, SWEEP_INTERVAL_MS);

  logger.info({ intervalMs: SWEEP_INTERVAL_MS }, "Sweepers started");
}

export function stopSweepers(): void {
  if (sweepTimer) {
    clearInterval(sweepTimer);
    sweepTimer = null;
    logger.info("Sweepers stopped");
  }
}

export async function runManualSweep(): Promise<void> {
  await runSweep();
}
