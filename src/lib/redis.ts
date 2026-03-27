import { Redis } from "ioredis";
import { env } from "../config/env.js";
import logger from "./logger.js";

const redis = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: 3,
  retryStrategy(times: number) {
    const delay = Math.min(times * 50, 2000);
    return delay;
  }
});

redis.on("error", (err: Error) => {
  logger.error({ err }, "Redis connection error");
});

redis.on("connect", () => {
  logger.info("Connected to Redis 🚀");
});

export default redis;
