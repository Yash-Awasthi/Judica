// This is the CANONICAL database pool (pg.Pool).
// lib/drizzle.ts wraps this pool with Drizzle ORM.
// Use lib/drizzle.ts for all ORM queries; use this file for raw SQL via pool.query().
import { env } from "../config/env.js";
import pg from "pg";
import logger from "./logger.js";

let dbUrl: URL;
try {
  dbUrl = new URL(env.DATABASE_URL);
} catch {
  throw new Error(`Invalid DATABASE_URL: cannot parse as URL. Check your .env configuration.`);
}
const connectionLimitStr = dbUrl.searchParams.get("connection_limit");
// Guard against NaN — parseInt("abc") returns NaN, which silently uses driver default
const parsedLimit = connectionLimitStr ? parseInt(connectionLimitStr, 10) : NaN;
const maxConnections = Number.isFinite(parsedLimit) && parsedLimit > 0 ? parsedLimit : 20;

// Enforce SSL/TLS for non-localhost connections
const isLocalhost = dbUrl.hostname === "localhost" || dbUrl.hostname === "127.0.0.1";
// Default to validating SSL certs for non-localhost. Set DB_SSL_REJECT_UNAUTHORIZED=false only for self-signed certs.
const sslConfig = isLocalhost
  ? undefined
  : { rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED !== "false" };

export const pool = new pg.Pool({
  connectionString: env.DATABASE_URL,
  max: maxConnections,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
  statement_timeout: 30_000,
  // Set application_name for pg_stat_activity visibility
  application_name: "aibyai-api",
  ssl: sslConfig,
});

pool.on("error", (err) => {
  logger.error({ err, total: pool.totalCount, idle: pool.idleCount }, "Database pool error");
});

// Downgrade acquire logging to trace level — was creating log noise at INFO level
pool.on("acquire", () => {
  logger.trace({ total: pool.totalCount, idle: pool.idleCount }, "DB connection acquired");
});
