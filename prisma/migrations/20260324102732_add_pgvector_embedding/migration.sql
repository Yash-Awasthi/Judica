-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "vector";

-- AlterTable
ALTER TABLE "SemanticCache" ADD COLUMN     "embedding" vector(1536);
