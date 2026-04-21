import { Redis } from "ioredis";
import logger from "../lib/logger.js";

const connection = new Redis(
  process.env.REDIS_URL || "redis://localhost:6379",
  { maxRetriesPerRequest: null }
);

connection.on("error", (err) => {
  logger.error({ err }, "Redis connection error");
});

connection.on("reconnecting", () => {
  logger.info("Redis reconnecting");
});

export default connection;
