import { buildApp } from "./app.js";
import { env } from "./config/env.js";
import logger from "./lib/logger.js";
import { pool } from "./lib/db.js";
import redis from "./lib/redis.js";
import { initSocket } from "./lib/socket.js";
import { startSweepers } from "./lib/sweeper.js";
import { startWorkers, stopWorkers } from "./queue/workers.js";
import { startMemoryCrons } from "./queue/memoryCrons.js";
import { cleanupRateLimitRedis } from "./middleware/rateLimit.js";
import { cleanupCostTrackerInterval } from "./lib/realtimeCost.js";

// P8-10: Wrap buildApp() in try/catch with error classification
let app;
try {
  app = await buildApp();
} catch (err) {
  const msg = (err as Error).message || "";
  if (msg.includes("EADDRINUSE") || msg.includes("port")) {
    logger.fatal({ err }, "Port conflict — another process is using this port");
  } else if (msg.includes("connect") || msg.includes("ECONNREFUSED")) {
    logger.fatal({ err }, "Database connection error — check DB connectivity");
  } else {
    logger.fatal({ err }, "Fatal startup error in buildApp()");
  }
  process.exit(1);
}

try {
  const port = Number(env.PORT);
  if (!Number.isFinite(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid PORT: ${env.PORT} — must be a number between 1 and 65535`);
  }
  await app.listen({ port, host: "0.0.0.0" });
  logger.info({ port: env.PORT, env: env.NODE_ENV }, "Council server started (Fastify)");

  startSweepers();
  startMemoryCrons();
  startWorkers();

  // Initialize WebSocket on the underlying Node.js HTTP server
  initSocket(app.server);
} catch (err) {
  logger.fatal({ err }, "Failed to start server");
  process.exit(1);
}

// P8-11: Guard against double-signal race
let isShuttingDown = false;

// Graceful shutdown
// P4-10: Use GRACEFUL_SHUTDOWN_MS from env instead of hardcoded 5s
const shutdown = async (signal: string) => {
  // P8-11: Second signal force-exits immediately
  if (isShuttingDown) {
    logger.warn({ signal }, "Second shutdown signal received, forcing exit");
    process.exit(1);
  }
  isShuttingDown = true;

  logger.info({ signal }, "Shutdown signal received, shutting down gracefully");

  const shutdownMs = env.GRACEFUL_SHUTDOWN_MS ?? 10_000;
  const forceTimer = setTimeout(() => {
    logger.error(`Graceful shutdown timed out after ${shutdownMs}ms, forcing exit`);
    process.exit(1);
  }, shutdownMs);
  forceTimer.unref();

  try {
    await app.close();
    logger.info("Fastify server closed");
  } catch (err) {
    logger.error({ err }, "Error closing Fastify server");
  }

  try {
    await stopWorkers();
    logger.info("BullMQ workers stopped");
  } catch (err) {
    logger.error({ err }, "Error stopping workers");
  }

  try {
    await pool.end();
    logger.info("Database pool closed");
  } catch (err) {
    logger.error({ err }, "Error closing database pool");
  }

  try {
    await redis.quit();
    logger.info("Redis connection closed");
  } catch (err) {
    logger.error({ err }, "Error closing Redis connection");
  }

  try {
    await cleanupRateLimitRedis();
    logger.info("Rate limit Redis connection closed");
  } catch (err) {
    logger.error({ err }, "Error closing rate limit Redis");
  }

  cleanupCostTrackerInterval();

  logger.info("Server closed");
  process.exit(0);
};

// P8-12: Remove any existing listeners before registering to prevent stacking
process.removeAllListeners("SIGTERM");
process.removeAllListeners("SIGINT");
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT",  () => shutdown("SIGINT"));

// P8-09: Don't exit immediately on uncaught exceptions — attempt graceful drain
process.on("uncaughtException", (err) => {
  logger.fatal({ err }, "Uncaught exception — initiating graceful shutdown");
  shutdown("uncaughtException").catch(() => process.exit(1));
});

process.on("unhandledRejection", (reason) => {
  logger.fatal({ reason }, "Unhandled rejection — initiating graceful shutdown");
  shutdown("unhandledRejection").catch(() => process.exit(1));
});
