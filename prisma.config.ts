import path from "path";
import "dotenv/config";
import { defineConfig } from "prisma/config";

const connectionString = process.env.DATABASE_URL || "postgresql://placeholder:placeholder@localhost:5432/placeholder";

export default defineConfig({
  schema: path.join("prisma", "schema.prisma"),
  datasource: {
    url: connectionString,
  },
});