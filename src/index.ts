import { buildApp } from "./app.js";
import { env } from "./config/env.js";
import logger from "./lib/logger.js";
import { pool } from "./lib/db.js";
import redis from "./lib/redis.js";
import { initSocket } from "./lib/socket.js";
import { startSweepers } from "./lib/sweeper.js";
import { startWorkers, stopWorkers } from "./queue/workers.js";
import { startMemoryCrons } from "./lib/memoryCrons.js";
import { cleanupRateLimitRedis } from "./middleware/rateLimit.js";
import { cleanupCostTrackerInterval } from "./lib/realtimeCost.js";

const app = await buildApp();

try {
  await app.listen({ port: Number(env.PORT), host: "0.0.0.0" });
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

// Graceful shutdown
const shutdown = async (signal: string) => {
  logger.info({ signal }, "Shutdown signal received, shutting down gracefully");

  const forceTimer = setTimeout(() => {
    logger.error("Graceful shutdown timed out after 5s, forcing exit");
    process.exit(1);
  }, 5000);
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

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT",  () => shutdown("SIGINT"));

process.on("uncaughtException", (err) => {
  logger.fatal({ err }, "Uncaught exception");
  process.exit(1);
});

process.on("unhandledRejection", (reason) => {
  logger.fatal({ reason }, "Unhandled rejection");
  process.exit(1);
});
