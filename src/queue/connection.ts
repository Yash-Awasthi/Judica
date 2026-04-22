import { Redis } from "ioredis";
import logger from "../lib/logger.js";

const connection = new Redis(
  process.env.REDIS_URL || "redis://localhost:6379",
  { maxRetriesPerRequest: null }
);

connection.on("error", (err) => {
  logger.error({ err: err.message }, "BullMQ Redis connection error");
});

export default connection;
