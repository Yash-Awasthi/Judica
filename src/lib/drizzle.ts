import { drizzle } from "drizzle-orm/node-postgres";
import { pool } from "./db.js";
import * as schema from "../db/schema/index.js";

export const db = drizzle(pool, { schema });
