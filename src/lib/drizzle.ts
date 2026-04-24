import { drizzle, NodePgDatabase } from "drizzle-orm/node-postgres";
import { pool } from "./db.js";
import * as schema from "../db/schema/index.js";
import logger from "./logger.js";

// ORM bypass risk — `db.$client` exposes the underlying pg.Pool.
// All queries MUST go through the Drizzle ORM layer (this module) to ensure:
//   1. Query logging (P9-47) captures all SQL
//   2. Schema validation is applied
//   3. Audit/tracing hooks can intercept queries
// Direct pool.query() usage is reserved for migrations and health checks only.
// See lib/db.ts for the raw pool (used sparingly by design).

// Lazy initialization — Drizzle ORM client created on first use,
// not at module load. This prevents DB failures during startup from crashing
// the process before Fastify can report health.
let _db: NodePgDatabase<typeof schema> | null = null;

export function getDb(): NodePgDatabase<typeof schema> {
  if (!_db) {
    _db = drizzle(pool, {
      schema,
      // Enable query logging for slow query debugging
      logger: {
        logQuery(query: string, params: unknown[]) {
          // Add truncation marker so developers know the query was cut
          const truncated = query.length > 200 ? query.slice(0, 200) + "…[truncated]" : query;
          logger.trace({ query: truncated, paramCount: params.length }, "Drizzle query");
        },
      },
    });
  }
  return _db;
}

// Export as getter proxy for backward compatibility —
// existing code uses `db.select()` etc. without calling getDb()
export const db = new Proxy({} as NodePgDatabase<typeof schema>, {
  get(_target, prop) {
    return Reflect.get(getDb(), prop);
  },
});
