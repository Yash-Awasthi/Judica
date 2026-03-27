import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { env } from "../config/env.js";
import pg from "pg";

import logger from "./logger.js";

const dbUrl = new URL(env.DATABASE_URL);
const connectionLimitStr = dbUrl.searchParams.get("connection_limit");
const maxConnections = connectionLimitStr ? parseInt(connectionLimitStr, 10) : 20;

export const pool = new pg.Pool({ 
  connectionString: env.DATABASE_URL,
  max: maxConnections 
});

pool.on("error", (err) => {
  logger.error({ err }, "Unexpected error on idle database client");
});

const adapter = new PrismaPg(pool as any);
const prisma = new PrismaClient({ adapter });

export default prisma;