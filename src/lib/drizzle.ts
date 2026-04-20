import { drizzle, NodePgDatabase } from "drizzle-orm/node-postgres";
import { pool } from "./db.js";
import * as schema from "../db/schema/index.js";
import logger from "./logger.js";

// P9-48: ORM bypass risk — `db.$client` exposes the underlying pg.Pool.
// All queries MUST go through the Drizzle ORM layer (this module) to ensure:
//   1. Query logging (P9-47) captures all SQL
//   2. Schema validation is applied
//   3. Audit/tracing hooks can intercept queries
// Direct pool.query() usage is reserved for migrations and health checks only.
// See lib/db.ts for the raw pool (used sparingly by design).

// P9-45: Lazy initialization — Drizzle ORM client created on first use,
// not at module load. This prevents DB failures during startup from crashing
// the process before Fastify can report health.
let _db: NodePgDatabase<typeof schema> | null = null;

export function getDb(): NodePgDatabase<typeof schema> {
  if (!_db) {
    _db = drizzle(pool, {
      schema,
      // P9-47: Enable query logging for slow query debugging
      logger: {
        logQuery(query: string, params: unknown[]) {
          logger.trace({ query: query.slice(0, 200), paramCount: params.length }, "Drizzle query");
        },
      },
    });
  }
  return _db;
}

// P9-45: Export as getter proxy for backward compatibility —
// existing code uses `db.select()` etc. without calling getDb()
export const db = new Proxy({} as NodePgDatabase<typeof schema>, {
  get(_target, prop) {
    return Reflect.get(getDb(), prop);
  },
});
