import { env } from "../config/env.js";
import pg from "pg";
import logger from "./logger.js";

const dbUrl = new URL(env.DATABASE_URL);
const connectionLimitStr = dbUrl.searchParams.get("connection_limit");
const maxConnections = connectionLimitStr ? parseInt(connectionLimitStr, 10) : 20;

export const pool = new pg.Pool({
  connectionString: env.DATABASE_URL,
  max: maxConnections,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
  statement_timeout: 30_000,
});

pool.on("error", (err) => {
  logger.error({ err, total: pool.totalCount, idle: pool.idleCount }, "Database pool error");
});

pool.on("acquire", () => {
  logger.debug({ total: pool.totalCount, idle: pool.idleCount }, "DB connection acquired");
});
