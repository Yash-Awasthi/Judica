import prisma from "./db.js";
import redis from "./redis.js";
import logger from "./logger.js";
import { env } from "../config/env.js";

const SWEEP_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
const CACHE_TTL_HOURS = 24; // 24 hours
const TOKEN_TTL_DAYS = 90; // 90 days

let sweepTimer: NodeJS.Timeout | null = null;

async function sweepCache(): Promise<number> {
  try {
    const result = await prisma.semanticCache.deleteMany({
      where: {
        expiresAt: {
          lt: new Date(),
        },
      },
    });
    if (result.count > 0) {
      logger.info({ count: result.count }, "Swept expired cache entries");
    }
    return result.count;
  } catch (err) {
    logger.error({ err: (err as Error).message }, "Failed to sweep cache");
    return 0;
  }
}

async function sweepRevokedTokens(): Promise<number> {
  try {
    const result = await prisma.revokedToken.deleteMany({
      where: {
        expiresAt: {
          lt: new Date(),
        },
      },
    });
    if (result.count > 0) {
      logger.info({ count: result.count }, "Swept expired revoked tokens");
    }
    return result.count;
  } catch (err) {
    logger.error({ err: (err as Error).message }, "Failed to sweep revoked tokens");
    return 0;
  }
}

async function sweepAuditLogs(): Promise<number> {
  try {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - TOKEN_TTL_DAYS);

    const result = await prisma.auditLog.deleteMany({
      where: {
        createdAt: {
          lt: cutoff,
        },
      },
    });
    if (result.count > 0) {
      logger.info({ count: result.count }, "Swept old audit logs");
    }
    return result.count;
  } catch (err) {
    logger.error({ err: (err as Error).message }, "Failed to sweep audit logs");
    return 0;
  }
}

async function sweepContextSummaries(): Promise<number> {
  try {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 30);

    const result = await prisma.contextSummary.deleteMany({
      where: {
        createdAt: {
          lt: cutoff,
        },
      },
    });
    if (result.count > 0) {
      logger.info({ count: result.count }, "Swept old context summaries");
    }
    return result.count;
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
      const ttl = await redis.ttl(key);
      if (ttl === -1 || ttl <= 0) {
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